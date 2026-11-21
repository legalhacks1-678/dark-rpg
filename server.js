const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// BUMP THIS VERSION TO TRIGGER AN AUTO-UPDATE ON ALL DEVICES
const GAME_VERSION = "0.0.2";

const ITEMS = {
    weapons: {
        'claws_1': { name: 'Basic Claws', reqLevel: 1, class: 'Werewolf' },
        'claws_2': { name: 'Bloodhound Talons', reqLevel: 3, class: 'Werewolf' },
        'dagger_1': { name: 'Bone Dagger', reqLevel: 1, class: 'Vampire' },
        'dagger_2': { name: 'Crimson Rapier', reqLevel: 3, class: 'Vampire' },
        'wand_1': { name: 'Wooden Wand', reqLevel: 1, class: 'Witch' },
        'wand_2': { name: 'Cursed Staff', reqLevel: 3, class: 'Witch' }
    },
    armors: {
        'pelt_1': { name: 'Wolf Fur', reqLevel: 1, class: 'Werewolf' },
        'pelt_2': { name: 'Iron Hide', reqLevel: 3, class: 'Werewolf' },
        'cape_1': { name: 'Shadow Cloak', reqLevel: 1, class: 'Vampire' },
        'cape_2': { name: 'Nightstalker Garb', reqLevel: 3, class: 'Vampire' },
        'robe_1': { name: 'Linen Robe', reqLevel: 1, class: 'Witch' },
        'robe_2': { name: 'Hexed Shroud', reqLevel: 3, class: 'Witch' }
    }
};

let players = {};

io.on('connection', (socket) => {
    // Send current server version on connect
    socket.emit('versionCheck', GAME_VERSION);

    socket.on('joinGame', (data) => {
        players[socket.id] = {
            id: socket.id,
            x: (Math.random() - 0.5) * 10,
            z: (Math.random() - 0.5) * 10,
            rotation: 0,
            characterClass: data.characterClass,
            subclass: data.subclass,
            level: 1,
            xp: 0,
            weapon: data.characterClass === 'Werewolf' ? 'claws_1' : (data.characterClass === 'Vampire' ? 'dagger_1' : 'wand_1'),
            armor: data.characterClass === 'Werewolf' ? 'pelt_1' : (data.characterClass === 'Vampire' ? 'cape_1' : 'robe_1')
        };
        socket.emit('init', { id: socket.id, players, items: ITEMS });
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

    socket.on('gainXP', () => {
        const p = players[socket.id];
        if (p) {
            p.xp += 50;
            if (p.xp >= p.level * 100) {
                p.level += 1;
                p.xp = 0;
            }
            io.emit('playerUpdated', p);
        }
    });

    socket.on('equipItem', ({ type, itemId }) => {
        const p = players[socket.id];
        const item = ITEMS[type][itemId];
        if (p && item) {
            if (p.level >= item.reqLevel && p.characterClass === item.class) {
                p[type === 'weapons' ? 'weapon' : 'armor'] = itemId;
                io.emit('playerUpdated', p);
            } else {
                socket.emit('equipFailed', `Requires Level ${item.reqLevel} ${item.class}!`);
            }
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[DarkRPG] Server running on port 3000 | Game Version: ${GAME_VERSION}`);
});
