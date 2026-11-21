const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const GAME_VERSION = "0.0.5";

// Day/Night Cycle (Total: 120s -> 60s Day, 60s Night)
let worldTime = 0; // 0 to 120
let isDay = true;
let isFullMoon = false;

setInterval(() => {
    worldTime = (worldTime + 1) % 120;
    isDay = worldTime < 60;
    isFullMoon = worldTime >= 90; // Full Moon in the late night
    io.emit('timeSync', { worldTime, isDay, isFullMoon });
}, 1000);

// Global Boss State
let boss = {
    x: 0, z: 0,
    maxHp: 2000, hp: 2000,
    state: 'idle', // idle, telegraph, striking, staggered
    currentTelegraph: null, // 'parry', 'dodge', 'technique'
    targetId: null
};

// Boss Combat Loop
setInterval(() => {
    if (Object.keys(players).length === 0) return;
    if (boss.state === 'idle') {
        // Choose random telegraph attack
        const attacks = ['parry', 'dodge', 'technique'];
        boss.currentTelegraph = attacks[Math.floor(Math.random() * attacks.length)];
        boss.state = 'telegraph';
        
        io.emit('bossTelegraphStart', {
            type: boss.currentTelegraph,
            duration: 1800 // 1.8 second windup
        });

        setTimeout(() => {
            if (boss.state === 'telegraph') {
                boss.state = 'striking';
                io.emit('bossStrike', { type: boss.currentTelegraph });
                setTimeout(() => {
                    boss.state = 'idle';
                }, 1000);
            }
        }, 1800);
    }
}, 6000);

let players = {};

io.on('connection', (socket) => {
    socket.emit('versionCheck', GAME_VERSION);

    socket.on('joinGame', (data) => {
        players[socket.id] = {
            id: socket.id,
            x: (Math.random() - 0.5) * 8 + 6,
            z: (Math.random() - 0.5) * 8 + 6,
            rotation: 0,
            characterClass: data.characterClass,
            subclass: data.subclass,
            trait: data.trait, // 'Vampire', 'Werewolf', or 'Human'
            level: 1,
            xp: 0,
            hp: 100,
            maxHp: 100,
            stamina: 100,
            isTransformed: false
        };

        socket.emit('init', { id: socket.id, players, boss, worldTime, isDay, isFullMoon });
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

    // Client validates defensive action
    socket.on('defendSuccess', (data) => {
        if (boss.state === 'telegraph' || boss.state === 'striking') {
            boss.hp -= 120;
            boss.state = 'staggered';
            io.emit('bossDamaged', { hp: boss.hp, maxHp: boss.maxHp, staggered: true });

            // Reward player XP
            const p = players[socket.id];
            if (p) {
                p.xp += 40;
                if (p.xp >= p.level * 80) {
                    p.level += 1;
                    p.xp = 0;
                    p.maxHp += 20;
                    p.hp = p.maxHp;
                }
                io.emit('playerUpdated', p);
            }

            setTimeout(() => { boss.state = 'idle'; }, 2500);
        }
    });

    socket.on('attackBoss', () => {
        if (players[socket.id] && boss.hp > 0) {
            const p = players[socket.id];
            let dmg = p.characterClass === 'Warrior' ? 35 : (p.characterClass === 'Assassin' ? 25 : 30);
            if (p.trait === 'Werewolf' && (p.isTransformed || isFullMoon)) dmg *= 1.4;

            boss.hp = Math.max(0, boss.hp - dmg);
            io.emit('bossDamaged', { hp: boss.hp, maxHp: boss.maxHp, staggered: false });

            if (boss.hp <= 0) {
                io.emit('bossDefeated');
                setTimeout(() => {
                    boss.hp = boss.maxHp;
                    io.emit('bossRespawn', boss);
                }, 8000);
            }
        }
    });

    socket.on('toggleWerewolf', () => {
        const p = players[socket.id];
        if (p && p.trait === 'Werewolf') {
            p.isTransformed = !p.isTransformed;
            io.emit('playerUpdated', p);
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[DarkRPG Engine] Running on port ${PORT} | Version: ${GAME_VERSION}`);
});
