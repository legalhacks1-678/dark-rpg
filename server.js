const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const GAME_VERSION = "0.0.6";

// Day/Night Cycle (90s Day, 60s Night)
let worldTime = 0;
let isDay = true;
let isFullMoon = false;

setInterval(() => {
    worldTime = (worldTime + 1) % 150;
    isDay = worldTime < 90;
    isFullMoon = worldTime >= 120;
    io.emit('timeSync', { worldTime, isDay, isFullMoon });
}, 1000);

// Fixed Enemy Spawns (Skyrim-style locations)
let enemies = [
    { id: 'wolf_1', type: 'werewolf', name: 'Alpha Lycan', x: 60, z: -60, hp: 450, maxHp: 450, zone: 'Mountain Ridge' },
    { id: 'vamp_1', type: 'vampire', name: 'Crypt Vampire Lord', x: -50, z: -50, hp: 400, maxHp: 400, zone: 'Deep Cave' },
    { id: 'rogue_1', type: 'rogue', name: 'Wilderness Outlaw', x: 10, z: 30, hp: 200, maxHp: 200, zone: 'Valley Camp' }
];

let players = {};

io.on('connection', (socket) => {
    socket.emit('versionCheck', GAME_VERSION);

    socket.on('joinGame', (data) => {
        players[socket.id] = {
            id: socket.id,
            x: 0, z: 15,
            rotation: 0,
            characterClass: data.characterClass || 'Warrior',
            trait: 'Human', // Starts human until bitten & survives!
            infection: null, // { type: 'Vampire'|'Werewolf', timer: 45 }
            level: 1, xp: 0,
            hp: 120, maxHp: 120,
            stamina: 100,
            inventory: { iron_ore: 2, herbs: 3, wolf_pelt: 0, vampire_dust: 0, iron_sword: 0, wolf_armor: 0, sun_potion: 0 }
        };

        socket.emit('init', { id: socket.id, players, enemies, worldTime, isDay, isFullMoon });
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

    // Player attacks spotted enemy
    socket.on('attackEnemy', (enemyId) => {
        const p = players[socket.id];
        const enemy = enemies.find(e => e.id === enemyId);
        if (!p || !enemy || enemy.hp <= 0) return;

        let dmg = 35 + (p.level * 5);
        if (p.inventory.iron_sword > 0) dmg += 25;
        if (p.trait === 'Werewolf') dmg *= 1.5;

        enemy.hp = Math.max(0, enemy.hp - dmg);
        io.emit('enemyUpdated', enemy);

        // Retaliation & Infection Chance
        if (enemy.hp > 0) {
            const retaliationDmg = 20;
            p.hp -= retaliationDmg;

            // BITE INFECTION LOGIC (Only if not already monster & survived hit)
            if (p.hp > 0 && p.trait === 'Human' && !p.infection) {
                if (enemy.type === 'vampire' && Math.random() < 0.40) {
                    p.infection = { type: 'Vampire', timer: 45 };
                    socket.emit('infectionContracted', { type: 'Vampire', duration: 45 });
                } else if (enemy.type === 'werewolf' && Math.random() < 0.40) {
                    p.infection = { type: 'Werewolf', timer: 45 };
                    socket.emit('infectionContracted', { type: 'Werewolf', duration: 45 });
                }
            }

            // DEATH CHECK: IF YOU DIE, INFECTION IS WIPED!
            if (p.hp <= 0) {
                p.infection = null; // Died before turning!
                p.hp = p.maxHp;
                p.x = 0; p.z = 15; // Respawn at starter shrine
                socket.emit('playerDied', "You were slain! The infection was purged by death.");
            }
            io.emit('playerUpdated', p);
        } else {
            // Enemy Loot Drops
            if (enemy.type === 'werewolf') p.inventory.wolf_pelt += 2;
            if (enemy.type === 'vampire') p.inventory.vampire_dust += 2;
            p.xp += 60;
            if (p.xp >= p.level * 100) { p.level++; p.xp = 0; p.maxHp += 20; p.hp = p.maxHp; }
            io.emit('playerUpdated', p);
            socket.emit('lootReceived', `Looted ${enemy.name}!`);

            // Respawn enemy after 20 seconds
            setTimeout(() => {
                enemy.hp = enemy.maxHp;
                io.emit('enemyUpdated', enemy);
            }, 20000);
        }
    });

    // Resource Gathering
    socket.on('gatherResource', (type) => {
        const p = players[socket.id];
        if (p && p.inventory[type] !== undefined) {
            p.inventory[type] += 1;
            socket.emit('playerUpdated', p);
            socket.emit('lootReceived', `Gathered 1x ${type.replace('_', ' ')}!`);
        }
    });

    // Crafting
    socket.on('craftItem', (recipe) => {
        const p = players[socket.id];
        if (!p) return;
        if (recipe === 'iron_sword' && p.inventory.iron_ore >= 3) {
            p.inventory.iron_ore -= 3; p.inventory.iron_sword += 1;
        } else if (recipe === 'wolf_armor' && p.inventory.wolf_pelt >= 3) {
            p.inventory.wolf_pelt -= 3; p.inventory.wolf_armor += 1; p.maxHp += 40; p.hp += 40;
        } else if (recipe === 'sun_potion' && p.inventory.vampire_dust >= 1 && p.inventory.herbs >= 2) {
            p.inventory.vampire_dust -= 1; p.inventory.herbs -= 2; p.inventory.sun_potion += 1;
        }
        socket.emit('playerUpdated', p);
    });

    // Infection Incubation Countdown
    setInterval(() => {
        const p = players[socket.id];
        if (p && p.infection) {
            p.infection.timer -= 1;
            if (p.infection.timer <= 0) {
                // SURVIVED! Turn into monster!
                p.trait = p.infection.type;
                p.infection = null;
                socket.emit('transformed', p.trait);
                io.emit('playerUpdated', p);
            }
        }
    }, 1000);

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Skyrim RPG Engine] Running on port ${PORT} | Version: ${GAME_VERSION}`);
});
