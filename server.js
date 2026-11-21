const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const GAME_VERSION = "0.0.9";

// World Clock (120s cycle: 60s Day, 30s Night, 30s Full Moon)
let worldTime = 0;
let isDay = true;
let isFullMoon = false;

setInterval(() => {
    worldTime = (worldTime + 1) % 120;
    isDay = worldTime < 60;
    isFullMoon = worldTime >= 90;
    io.emit('timeSync', { worldTime, isDay, isFullMoon });
}, 1000);

// Multi-Village Banking & Regional Debt
let villageBanks = {
    Riverwood: { defaultDebt: 0 },
    Frostcrag: { defaultDebt: 0 },
    Duskwood: { defaultDebt: 0 }
};

// Training Dummy
let dummy = { x: 0, y: 1, z: -12, currentTelegraph: 'white' };
setInterval(() => {
    const teleg = ['white', 'red', 'violet'];
    dummy.currentTelegraph = teleg[Math.floor(Math.random() * teleg.length)];
    io.emit('dummyTelegraph', { type: dummy.currentTelegraph, duration: 1600 });
}, 4500);

let players = {};

io.on('connection', (socket) => {
    socket.emit('versionCheck', GAME_VERSION);

    socket.on('joinGame', (data) => {
        players[socket.id] = {
            id: socket.id,
            x: 0, y: 3, z: 6, rotation: 0,
            characterClass: data.characterClass || 'Warrior',
            subclass: data.subclass || 'Medium',
            trait: data.trait || 'Human',
            level: 1, xp: 0,
            hp: 120, maxHp: 120, stamina: 100,
            carriedGold: 60,
            banks: { Riverwood: 100, Frostcrag: 0, Duskwood: 0 },
            debts: { Riverwood: 0, Frostcrag: 0, Duskwood: 0 },
            offHand: data.offHand || 'Shield'
        };

        socket.emit('init', { id: socket.id, players, dummy, worldTime, isDay, isFullMoon });
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

    socket.on('takeDamage', ({ amount, reason }) => {
        const p = players[socket.id];
        if (!p) return;
        p.hp = Math.max(0, p.hp - amount);
        socket.emit('feedback', `Took ${amount} damage (${reason})!`);
        
        if (p.hp <= 0) {
            const lost = Math.floor(p.carriedGold * 0.15);
            p.carriedGold -= lost;
            p.hp = p.maxHp;
            p.x = 0; p.y = 3; p.z = 6;
            socket.emit('feedback', `You died! Dropped ${lost}g carried gold. Village banks are safe.`);
        }
        io.emit('playerUpdated', p);
    });

    socket.on('bankAction', ({ village, action, amount }) => {
        const p = players[socket.id];
        if (!p) return;
        if (!p.banks[village]) p.banks[village] = 0;
        if (!p.debts[village]) p.debts[village] = 0;

        if (action === 'deposit' && p.carriedGold >= amount) {
            p.carriedGold -= amount; p.banks[village] += amount;
        } else if (action === 'withdraw' && p.banks[village] >= amount) {
            p.banks[village] -= amount; p.carriedGold += amount;
        } else if (action === 'loan') {
            p.carriedGold += 100; p.debts[village] += 120;
            socket.emit('feedback', `Borrowed 100g on credit from ${village}!`);
        } else if (action === 'repay' && p.carriedGold >= p.debts[village] && p.debts[village] > 0) {
            p.carriedGold -= p.debts[village]; p.debts[village] = 0;
            socket.emit('feedback', `Settled all debts in ${village}! Credit restored.`);
        }
        socket.emit('playerUpdated', p);
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Skyrim Voxel Engine 2.0] Running on port ${PORT} | Version: ${GAME_VERSION}`);
});
