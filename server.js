const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// Servir les fichiers statiques (le site web)
app.use(express.static(path.join(__dirname, "public")));

// --- LOGIQUE SUDOKU (Côté Serveur pour l'équité) ---
class SudokuGenerator {
  constructor() {}

  generate(difficulty) {
    // Génération simplifiée pour le serveur
    let grid = new Array(81).fill(0);
    this.fillGrid(grid);
    const solution = [...grid];

    // Retirer des cases
    let attempts =
      difficulty === "hard" ? 55 : difficulty === "medium" ? 45 : 30;
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
    // Backtracking simple
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
const rooms = {}; // { roomCode: { players: [], state: 'lobby', mode: 'speedrun', grid: {}, scores: {} } }

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on("connection", (socket) => {
  console.log("Un joueur connecté:", socket.id);

  // Créer une salle
  socket.on("create_room", ({ username, mode }) => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      code: roomCode,
      host: socket.id,
      state: "lobby", // lobby, playing, finished
      mode: mode, // 'speedrun', 'territory'
      players: [],
      gameData: null,
    };
    socket.emit("room_created", roomCode);
  });

  // Rejoindre une salle
  socket.on("join_room", ({ roomCode, username }) => {
    const room = rooms[roomCode];
    if (!room) {
      socket.emit("error", "Cette salle n'existe pas.");
      return;
    }
    if (room.state !== "lobby") {
      socket.emit("error", "La partie a déjà commencé.");
      return;
    }

    // Couleurs pour le mode Territoire
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
      score: 0, // Pour territoire
      progress: 0, // Pour speedrun
      color: playerColor,
    };

    room.players.push(player);
    socket.join(roomCode);

    // Informer tout le monde dans la salle
    io.to(roomCode).emit("update_lobby", {
      players: room.players,
      mode: room.mode,
      isHost: socket.id === room.host,
    });

    // Dire au joueur actuel qu'il a rejoint
    socket.emit("joined_success", {
      roomCode,
      playerId: socket.id,
      mode: room.mode,
    });
  });

  // Lancer la partie
  socket.on("start_game", (roomCode) => {
    const room = rooms[roomCode];
    if (!room || room.host !== socket.id) return;

    // Générer la grille unique pour tout le monde
    const difficulty = "medium"; // On pourrait le rendre dynamique
    room.gameData = sudokuGen.generate(difficulty);
    room.state = "playing";

    // Initialiser les territoires (vide)
    if (room.mode === "territory") {
      room.territoryMap = new Array(81).fill(null); // stocke l'ID du joueur propriétaire
    }

    io.to(roomCode).emit("game_started", {
      initial: room.gameData.initial,
      players: room.players,
    });
  });

  // --- LOGIQUE JEU ---

  socket.on("submit_move", ({ roomCode, index, value }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== "playing") return;

    const correctValue = room.gameData.solution[index];
    const isCorrect = value === correctValue;
    const player = room.players.find((p) => p.id === socket.id);

    if (!player) return;

    if (room.mode === "speedrun") {
      if (isCorrect) {
        // Vérifier si la grille est finie pour ce joueur (logique simplifiée via %)
        // Dans une vraie app, on traquerait la grille complète de chaque joueur côté serveur
        // Ici on fait confiance au client pour le calcul du % pour simplifier l'exemple
      }
    } else if (room.mode === "territory") {
      // Logique Territoire : Premier arrivé, premier servi sur une case juste
      if (isCorrect && room.territoryMap[index] === null) {
        room.territoryMap[index] = socket.id;
        player.score += 10;

        // Diffuser la prise de territoire
        io.to(roomCode).emit("territory_update", {
          index,
          value,
          ownerId: socket.id,
          color: player.color,
          scores: room.players.map((p) => ({ id: p.id, score: p.score })),
        });

        // Vérifier fin de partie (toutes cases remplies)
        const totalOwned = room.territoryMap.filter((x) => x !== null).length;
        const totalToFill = room.gameData.initial.filter((x) => x === 0).length; // Approximatif, compte les 0 initiaux

        // Simplification : si plus de mouvements possibles ou grille pleine
        // Pour cet exemple, on ne check pas la fin stricte ici pour garder le code concis
      } else if (!isCorrect) {
        // Pénalité optionnelle
        socket.emit("wrong_move", index);
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
        }))
      );

      if (progress === 100) {
        io.to(roomCode).emit("game_over", { winner: player.username });
        room.state = "finished";
      }
    }
  });

  socket.on("disconnect", () => {
    // Gérer la déconnexion (supprimer des rooms, etc.)
    // Simplifié ici
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serveur lancé sur le port ${PORT}`));
