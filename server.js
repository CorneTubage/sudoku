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
    };
    socket.emit("room_created", roomCode);
  });

  socket.on("join_room", ({ roomCode, username }) => {
    const room = rooms[roomCode];
    if (!room) {
      socket.emit("error", "Cette salle n'existe pas.");
      return;
    }
    // On autorise la reconnexion si la partie est en cours, mais on simplifie ici :
    // Si playing, on rejette sauf si on implémente une vraie reconnexion par ID (complexe).
    // Pour l'instant on garde le blocage si 'playing' pour les nouveaux.
    if (
      room.state !== "lobby" &&
      !room.players.find((p) => p.username === username)
    ) {
      // Petite tolérance si même pseudo (très basique)
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

    io.to(roomCode).emit("update_lobby", {
      players: room.players,
      mode: room.mode,
      difficulty: room.difficulty,
      hostId: room.host,
    });

    socket.emit("joined_success", {
      roomCode,
      playerId: socket.id,
      mode: room.mode,
      color: playerColor,
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
    leaveRoomLogic(socket, roomCode);
  });

  socket.on("disconnect", () => {
    for (const code in rooms) {
      const room = rooms[code];
      if (room.players.find((p) => p.id === socket.id)) {
        leaveRoomLogic(socket, code);
        break;
      }
    }
  });

  function leaveRoomLogic(socket, roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

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

    // Calcul du nombre de cases à remplir pour le calcul du %
    const totalEmpty = room.gameData.initial.filter((x) => x === 0).length;

    if (room.mode === "territory") room.territoryMap = new Array(81).fill(null);

    io.to(roomCode).emit("game_started", {
      initial: room.gameData.initial,
      players: room.players,
      totalEmpty: totalEmpty, // Important pour la barre de progression
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
      // Speedrun : validation simple côté serveur ou confiance au client (ici on ne fait rien de spécial, le client gère sa progression)
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
