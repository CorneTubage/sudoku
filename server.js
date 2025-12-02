const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(express.static(path.join(__dirname, "public")));

// --- LOGIQUE SUDOKU ---
class SudokuGenerator {
  constructor() {}
  generate(difficulty) {
    let grid = new Array(81).fill(0);
    this.fillGrid(grid);
    const solution = [...grid];

    let attempts;
    switch (difficulty) {
      case "easy":
        attempts = 30;
        break;
      case "hard":
        attempts = 55;
        break;
      case "medium":
      default:
        attempts = 45;
        break;
    }

    while (attempts > 0) {
      let idx = Math.floor(Math.random() * 81);
      if (grid[idx] !== 0) {
        grid[idx] = 0;
        attempts--;
      }
    }
    return { initial: grid, solution: solution };
  }

  fillGrid(grid) {
    for (let i = 0; i < 81; i++) {
      if (grid[i] === 0) {
        let nums = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5);
        for (let num of nums) {
          if (this.isValid(grid, i, num)) {
            grid[i] = num;
            if (this.fillGrid(grid)) return true;
            grid[i] = 0;
          }
        }
        return false;
      }
    }
    return true;
  }

  isValid(grid, index, num) {
    const row = Math.floor(index / 9);
    const col = index % 9;
    const boxRow = row - (row % 3);
    const boxCol = col - (col % 3);
    for (let i = 0; i < 9; i++) {
      if (grid[row * 9 + i] === num) return false;
      if (grid[i * 9 + col] === num) return false;
      const r = boxRow + Math.floor(i / 3);
      const c = boxCol + (i % 3);
      if (grid[r * 9 + c] === num) return false;
    }
    return true;
  }
}
const sudokuGen = new SudokuGenerator();

// --- GESTION DES SALLES ---
const rooms = {};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on("connection", (socket) => {
  socket.on("create_room", ({ username, mode }) => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      code: roomCode,
      host: socket.id,
      state: "lobby",
      mode: mode,
      difficulty: "medium",
      players: [],
      gameData: null,
      territoryMap: [],
      startTime: null,
    };
    socket.emit("room_created", roomCode);
  });

  socket.on("join_room", ({ roomCode, username }) => {
    const room = rooms[roomCode];
    if (!room) {
      socket.emit("error", "Cette salle n'existe pas.");
      return;
    }

    // --- RECONNEXION ---
    const existingPlayerIndex = room.players.findIndex(
      (p) => p.username === username
    );

    if (existingPlayerIndex !== -1) {
      const player = room.players[existingPlayerIndex];
      const oldId = player.id;
      player.id = socket.id; // Nouvel ID Socket

      if (room.host === oldId) room.host = socket.id;

      // FIX TERRITOIRE : Mettre à jour la carte avec le nouvel ID
      if (room.mode === "territory") {
        for (let i = 0; i < 81; i++) {
          if (room.territoryMap[i] === oldId) {
            room.territoryMap[i] = socket.id;
          }
        }
      }

      socket.join(roomCode);

      socket.emit("joined_success", {
        roomCode,
        playerId: socket.id,
        mode: room.mode,
        color: player.color,
      });

      if (room.state === "playing") {
        const totalEmpty = room.gameData.initial.filter((x) => x === 0).length;
        const elapsed = room.startTime
          ? Math.floor((Date.now() - room.startTime) / 1000)
          : 0;

        socket.emit("game_started", {
          initial: room.gameData.initial,
          players: room.players,
          totalEmpty: totalEmpty,
          timer: elapsed,
        });

        if (room.mode === "territory") {
          for (let i = 0; i < 81; i++) {
            if (room.territoryMap[i]) {
              // Maintenant on trouve le owner car on a mis à jour l'ID juste avant
              const owner = room.players.find(
                (p) => p.id === room.territoryMap[i]
              );
              if (owner) {
                socket.emit("territory_update", {
                  index: i,
                  value: room.gameData.solution[i],
                  ownerId: owner.id,
                  color: owner.color,
                  scores: room.players.map((p) => ({
                    id: p.id,
                    score: p.score,
                  })),
                });
              }
            }
          }
        }

        io.to(roomCode).emit("refresh_players", room.players);

        if (room.mode === "speedrun") {
          io.to(roomCode).emit(
            "progress_update",
            room.players.map((p) => ({
              id: p.id,
              username: p.username,
              progress: p.progress,
              color: p.color,
            }))
          );
        }
      } else {
        io.to(roomCode).emit("update_lobby", {
          players: room.players,
          mode: room.mode,
          difficulty: room.difficulty,
          hostId: room.host,
        });
      }
      return;
    }

    // --- NOUVEAU JOUEUR ---
    if (room.state !== "lobby") {
      socket.emit("error", "La partie a déjà commencé.");
      return;
    }

    const colors = [
      "#86efac",
      "#fca5a5",
      "#93c5fd",
      "#fde047",
      "#d8b4fe",
      "#fdba74",
    ];
    const playerColor = colors[room.players.length % colors.length];

    const player = {
      id: socket.id,
      username,
      score: 0,
      progress: 0,
      color: playerColor,
    };
    room.players.push(player);
    socket.join(roomCode);

    socket.emit("joined_success", {
      roomCode,
      playerId: socket.id,
      mode: room.mode,
      color: playerColor,
    });

    io.to(roomCode).emit("update_lobby", {
      players: room.players,
      mode: room.mode,
      difficulty: room.difficulty,
      hostId: room.host,
    });
  });

  socket.on("change_difficulty", ({ roomCode, difficulty }) => {
    const room = rooms[roomCode];
    if (room && room.host === socket.id) {
      room.difficulty = difficulty;
      io.to(roomCode).emit("update_lobby", {
        players: room.players,
        mode: room.mode,
        difficulty: room.difficulty,
        hostId: room.host,
      });
    }
  });

  socket.on("leave_room", (roomCode) => {
    leaveRoomLogic(socket, roomCode, true);
  });

  socket.on("disconnect", () => {
    for (const code in rooms) {
      const room = rooms[code];
      if (room.players.find((p) => p.id === socket.id)) {
        leaveRoomLogic(socket, code, false);
        break;
      }
    }
  });

  function leaveRoomLogic(socket, roomCode, forceRemove) {
    const room = rooms[roomCode];
    if (!room) return;

    if (room.state === "playing" && !forceRemove) {
      const p = room.players.find((p) => p.id === socket.id);
      if (p) {
        io.to(roomCode).emit("player_left_game", {
          id: socket.id,
          username: p.username,
          temporary: true,
        });
      }
      return;
    }

    const playerIndex = room.players.findIndex((p) => p.id === socket.id);
    const wasHost = room.host === socket.id;
    const playerName =
      playerIndex !== -1 ? room.players[playerIndex].username : "Un joueur";

    room.players = room.players.filter((p) => p.id !== socket.id);
    socket.leave(roomCode);

    if (room.players.length === 0) {
      delete rooms[roomCode];
    } else {
      if (room.state === "playing") {
        io.to(roomCode).emit("player_left_game", {
          id: socket.id,
          username: playerName,
          temporary: false,
        });
      } else {
        if (wasHost) room.host = room.players[0].id;
        io.to(roomCode).emit("update_lobby", {
          players: room.players,
          mode: room.mode,
          difficulty: room.difficulty,
          hostId: room.host,
        });
      }
    }
  }

  socket.on("start_game", (roomCode) => {
    const room = rooms[roomCode];
    if (!room || room.host !== socket.id) return;

    room.gameData = sudokuGen.generate(room.difficulty);
    room.state = "playing";
    room.startTime = Date.now();

    const totalEmpty = room.gameData.initial.filter((x) => x === 0).length;

    if (room.mode === "territory") room.territoryMap = new Array(81).fill(null);

    room.players.forEach((p) => {
      p.score = 0;
      p.progress = 0;
    });

    io.to(roomCode).emit("game_started", {
      initial: room.gameData.initial,
      players: room.players,
      totalEmpty: totalEmpty,
      timer: 0,
    });
  });

  socket.on("submit_move", ({ roomCode, index, value }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== "playing") return;

    const correctValue = room.gameData.solution[index];
    const isCorrect = value === correctValue;
    const player = room.players.find((p) => p.id === socket.id);

    if (!player) return;

    if (room.mode === "speedrun") {
      // ...
    } else if (room.mode === "territory") {
      if (isCorrect && room.territoryMap[index] === null) {
        room.territoryMap[index] = socket.id;
        player.score += 10;
        io.to(roomCode).emit("territory_update", {
          index,
          value,
          ownerId: socket.id,
          color: player.color,
          scores: room.players.map((p) => ({ id: p.id, score: p.score })),
        });

        const filled = room.territoryMap.filter((x) => x !== null).length;
        const totalZeros = room.gameData.initial.filter((x) => x === 0).length;
        if (filled >= totalZeros) {
          const winner = room.players.reduce((prev, current) =>
            prev.score > current.score ? prev : current
          );
          io.to(roomCode).emit("game_over", {
            winner: winner.username,
            fullGrid: room.gameData.solution,
          });
          room.state = "finished";
        }
      } else if (!isCorrect) {
        player.score -= 5;
        io.to(roomCode).emit("territory_penalty", {
          targetId: socket.id,
          index: index,
          scores: room.players.map((p) => ({ id: p.id, score: p.score })),
        });
      }
    }
  });

  socket.on("update_progress", ({ roomCode, progress }) => {
    const room = rooms[roomCode];
    if (!room || room.mode !== "speedrun") return;

    const player = room.players.find((p) => p.id === socket.id);
    if (player) {
      player.progress = progress;
      io.to(roomCode).emit(
        "progress_update",
        room.players.map((p) => ({
          id: p.id,
          username: p.username,
          progress: p.progress,
          color: p.color,
        }))
      );

      if (progress >= 100) {
        io.to(roomCode).emit("game_over", {
          winner: player.username,
          fullGrid: room.gameData.solution,
        });
        room.state = "finished";
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serveur lancé sur le port ${PORT}`));
