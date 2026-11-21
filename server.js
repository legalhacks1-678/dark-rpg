const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const GAME_VERSION = "0.1.0";

// World Clock (120s: 60s Day, 30s Night, 30s Full Moon)
let worldTime = 0, isDay = true, isFullMoon = false;
setInterval(() => {
    worldTime = (worldTime + 1) % 120;
    isDay = worldTime < 60;
    isFullMoon = worldTime >= 90;
    io.emit('timeSync', { worldTime, isDay, isFullMoon });
}, 1000);

// Region-Leashed Mobs (Minecraft-style behavior)
let mobs = [
    { id: 'm1', type: 'zombie', name: 'Riverwood Outlaw', x: 20, y: 1, z: 20, homeX: 20, homeZ: 20, hp: 100, maxHp: 100, regionRadius: 25 },
    { id: 'm2', type: 'wolf', name: 'Frost Wolf', x: 130, y: 10, z: -130, homeX: 130, homeZ: -130, hp: 140, maxHp: 140, regionRadius: 30 },
    { id: 'm3', type: 'vampire', name: 'Duskwood Thrall', x: -130, y: 1, z: 110, homeX: -130, homeZ: 110, hp: 180, maxHp: 180, regionRadius: 30 }
];

let players = {};

io.on('connection', (socket) => {
    socket.emit('versionCheck', GAME_VERSION);

    socket.on('joinGame', (data) => {
        players[socket.id] = {
            id: socket.id,
            x: 0, y: 4, z: 6, rotation: 0,
            characterClass: data.characterClass || 'Warrior',
            subclass: data.subclass || 'Medium',
            trait: data.trait || 'Human',
            level: 1, xp: 0, hp: 120, maxHp: 120, stamina: 100,
            carriedGold: 50,
            discoveredWaystones: ['Riverwood'], // Starter village unlocked
            banks: { Riverwood: 50, Frostcrag: 0, Duskwood: 0 },
            debts: { Riverwood: 0, Frostcrag: 0, Duskwood: 0 }
        };
        socket.emit('init', { id: socket.id, players, mobs, worldTime, isDay, isFullMoon });
        socket.broadcast.emit('newPlayer', players[socket.id]);
    });

    socket.on('move', (pos) => {
        if (players[socket.id]) {
            players[socket.id].x = pos.x;
            players[socket.id].y = pos.y;
            players[socket.id].z = pos.z;
            players[socket.id].rotation = pos.rotation;
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    socket.on('discoverWaystone', (name) => {
        const p = players[socket.id];
        if (p && !p.discoveredWaystones.includes(name)) {
            p.discoveredWaystones.push(name);
            socket.emit('feedback', `✨ Discovered ${name} Waystone! Fast travel unlocked.`);
            socket.emit('playerUpdated', p);
        }
    });

    socket.on('fastTravel', (dest) => {
        const p = players[socket.id];
        if (!p || !p.discoveredWaystones.includes(dest)) return;
        const coords = { Riverwood: {x: 0, z: 6}, Frostcrag: {x: 140, z: -140}, Duskwood: {x: -140, z: 120} };
        if (coords[dest]) {
            p.x = coords[dest].x; p.z = coords[dest].z; p.y = 8;
            socket.emit('teleport', p);
            io.emit('playerMoved', p);
            socket.emit('feedback', `Fast traveled to ${dest}!`);
        }
    });

    socket.on('attackMob', (mobId) => {
        const p = players[socket.id];
        const m = mobs.find(x => x.id === mobId);
        if (!p || !m || m.hp <= 0) return;
        m.hp = Math.max(0, m.hp - 35);
        io.emit('mobUpdated', m);
        if (m.hp <= 0) {
            p.xp += 40; p.carriedGold += 15;
            socket.emit('feedback', `Slain ${m.name}! +40 XP, +15 Gold`);
            setTimeout(() => { m.hp = m.maxHp; m.x = m.homeX; m.z = m.homeZ; io.emit('mobUpdated', m); }, 15000);
            io.emit('playerUpdated', p);
        }
    });

    socket.on('takeDamage', ({ amount, reason }) => {
        const p = players[socket.id];
        if (!p) return;
        p.hp = Math.max(0, p.hp - amount);
        socket.emit('feedback', `Took ${amount} damage (${reason})!`);
        if (p.hp <= 0) {
            const lost = Math.floor(p.carriedGold * 0.15);
            p.carriedGold -= lost;
            p.hp = p.maxHp; p.x = 0; p.y = 5; p.z = 6;
            socket.emit('feedback', `Died! Lost ${lost}g carried gold. Respawned at Riverwood.`);
        }
        io.emit('playerUpdated', p);
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Minecraft RPG Engine] Running on port ${PORT} | Version: ${GAME_VERSION}`);
});
