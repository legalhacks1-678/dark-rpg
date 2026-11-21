const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const GAME_VERSION = "0.0.7";

// Real-world Full Moon Clock (120s total: 60s Day, 30s Night, 30s Full Moon)
let worldTime = 0;
let isDay = true;
let isFullMoon = false;

setInterval(() => {
    worldTime = (worldTime + 1) % 120;
    isDay = worldTime < 60;
    isFullMoon = worldTime >= 90;
    io.emit('timeSync', { worldTime, isDay, isFullMoon });
}, 1000);

// Training Dummy (Spawns in Training Yard, endlessly cycles telegraphs for practice)
let dummy = {
    x: 0, z: -12,
    currentTelegraph: 'white', // white (parry), red (technique), violet (dive over hazard)
    active: true
};

setInterval(() => {
    const telegraphs = ['white', 'red', 'violet'];
    dummy.currentTelegraph = telegraphs[Math.floor(Math.random() * telegraphs.length)];
    io.emit('dummyTelegraph', { type: dummy.currentTelegraph, duration: 1600 });
}, 4500);

// Wilderness Boss: Rotwood Behemoth (25% HP Threshold Events)
let boss = {
    x: 45, z: -45,
    maxHp: 2000, hp: 2000,
    threshold: 4, // 4 = 100%, 3 = 75%, 2 = 50% (adds phase), 1 = 25% (enrage)
    state: 'idle',
    currentTelegraph: null
};

setInterval(() => {
    if (Object.keys(players).length === 0 || boss.hp <= 0) return;
    if (boss.state === 'idle') {
        boss.state = 'telegraph';
        const attacks = ['white', 'red', 'violet'];
        boss.currentTelegraph = attacks[Math.floor(Math.random() * attacks.length)];
        
        io.emit('bossTelegraph', { type: boss.currentTelegraph, duration: 1800 });
        setTimeout(() => {
            boss.state = 'idle';
        }, 2200);
    }
}, 5500);

let players = {};

io.on('connection', (socket) => {
    socket.emit('versionCheck', GAME_VERSION);

    socket.on('joinGame', (data) => {
        players[socket.id] = {
            id: socket.id,
            x: 0, z: 5, rotation: 0,
            characterClass: data.characterClass || 'Warrior',
            subclass: data.subclass || 'Medium',
            trait: data.trait || 'Human', // Vampire, Werewolf, Human
            level: 1, xp: 0,
            hp: 120, maxHp: 120, stamina: 100,
            carriedGold: 50, bankGold: 100, villageDebt: 0,
            offHand: 'Shield', // 'Shield' or 'Dagger'
            isTwoHanding: false,
            stance: 'Blade' // for Hybrid Guard: 'Shield' or 'Blade'
        };

        socket.emit('init', { id: socket.id, players, boss, dummy, worldTime, isDay, isFullMoon });
        socket.broadcast.emit('newPlayer', players[socket.id]);
    });

    socket.on('move', (pos) => {
        if (players[socket.id]) {
            players[socket.id].x = pos.x;
            players[socket.id].z = pos.z;
            players[socket.id].rotation = pos.rotation;
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    // Successful Defensive Reaction (Parry, Technique Counter, Dive over Violet)
    socket.on('defendSuccess', ({ type, target }) => {
        const p = players[socket.id];
        if (!p) return;

        if (target === 'dummy') {
            socket.emit('feedback', `Mastered ${type.toUpperCase()} reaction! +10 XP`);
            p.xp += 10;
        } else if (target === 'boss' && boss.hp > 0) {
            boss.hp -= 150;
            p.xp += 40;

            // Check 25% Thresholds
            const currentThreshold = Math.ceil((boss.hp / boss.maxHp) * 4);
            if (currentThreshold < boss.threshold) {
                boss.threshold = currentThreshold;
                io.emit('bossThresholdEvent', { threshold: boss.threshold });
            }
            io.emit('bossUpdated', boss);
        }

        if (p.xp >= p.level * 80) {
            p.level++; p.xp = 0; p.maxHp += 20; p.hp = p.maxHp;
            socket.emit('feedback', `Level Up! You are now Level ${p.level}!`);
        }
        io.emit('playerUpdated', p);
    });

    // Attacks
    socket.on('attackEntity', ({ target }) => {
        const p = players[socket.id];
        if (!p) return;

        let dmg = 25 + (p.level * 4);
        if (p.isTwoHanding) dmg *= 1.2; // Two-handing stance bonus
        if (p.characterClass === 'Guard' && p.stance === 'Blade') dmg *= 1.3;

        if (target === 'boss' && boss.hp > 0) {
            boss.hp = Math.max(0, boss.hp - dmg);
            io.emit('bossUpdated', boss);
            if (boss.hp <= 0) {
                io.emit('bossDefeated');
                setTimeout(() => { boss.hp = boss.maxHp; boss.threshold = 4; io.emit('bossUpdated', boss); }, 15000);
            }
        }
    });

    // Banking & Village Loan System
    socket.on('bankAction', ({ action, amount }) => {
        const p = players[socket.id];
        if (!p) return;
        if (action === 'deposit' && p.carriedGold >= amount) {
            p.carriedGold -= amount; p.bankGold += amount;
        } else if (action === 'withdraw' && p.bankGold >= amount) {
            p.bankGold -= amount; p.carriedGold += amount;
        } else if (action === 'loan') {
            p.carriedGold += 100; p.villageDebt += 120; // 20g interest
            socket.emit('feedback', "Borrowed 100g on Village Credit! Repay debt to maintain standing.");
        } else if (action === 'repay' && p.carriedGold >= p.villageDebt && p.villageDebt > 0) {
            p.carriedGold -= p.villageDebt; p.villageDebt = 0;
            socket.emit('feedback', "Village debt settled! Your credit rating is pristine.");
        }
        socket.emit('playerUpdated', p);
    });

    // Death Penalty: Lose 15% Carried Gold (Bank Gold is 100% Safe)
    socket.on('playerDied', () => {
        const p = players[socket.id];
        if (!p) return;
        const lost = Math.floor(p.carriedGold * 0.15);
        p.carriedGold -= lost;
        p.hp = p.maxHp;
        p.x = 0; p.z = 5;
        socket.emit('feedback', `You collapsed! Lost ${lost}g carried gold. Bank gold was safe.`);
        socket.emit('playerUpdated', p);
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[DarkRPG Master Engine] Running on port ${PORT} | Version: ${GAME_VERSION}`);
});
