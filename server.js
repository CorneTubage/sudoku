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

    // --- LOGIQUE DE RECONNEXION ---
    const existingPlayer = room.players.find((p) => p.username === username);

    if (existingPlayer) {
      // C'est une reconnexion ! On met à jour le socket ID
      const oldId = existingPlayer.id;
      existingPlayer.id = socket.id; // Mise à jour de l'identité technique

      // Si c'était l'hôte, on met à jour l'hôte
      if (room.host === oldId) {
        room.host = socket.id;
      }

      socket.join(roomCode);

      // 1. Confirmer la connexion avec les infos du joueur existant
      socket.emit("joined_success", {
        roomCode,
        playerId: socket.id,
        mode: room.mode,
        color: existingPlayer.color,
      });

      // 2. Si la partie est en cours, on renvoie TOUT l'état du jeu pour synchroniser
      if (room.state === "playing") {
        // Remplacer les cases vides par les cases du territoire possédées par d'autres
        let syncGrid = [...room.gameData.initial];

        // Calcul pour speedrun progression
        const totalEmpty = room.gameData.initial.filter((x) => x === 0).length;

        socket.emit("game_started", {
          initial: room.gameData.initial,
          players: room.players,
          totalEmpty: totalEmpty,
        });

        // Restaurer l'état du territoire
        if (room.mode === "territory") {
          room.territoryMap.forEach((ownerId, index) => {
            if (ownerId) {
              // Retrouver le propriétaire original (attention les ID ont pu changer si eux aussi ont reco,
              // mais on se base sur l'objet player référence)
              const owner = room.players.find(
                (p) =>
                  p.id === ownerId ||
                  p.username ===
                    room.players.find((old) => old.id === ownerId)?.username
              );
              // Note: La gestion parfaite des IDs en territoire demande une map persistante par username,
              // ici on simplifie en renvoyant l'état actuel

              // On ré-émet les updates de territoire pour remplir la grille visuelle
              // On doit trouver la valeur correcte
              const val = room.gameData.solution[index];
              // Trouver la couleur du propriétaire actuel de la case
              // (Le ownerId dans territoryMap est l'ID socket au moment de la capture)
              // On cherche le joueur qui a cet ID OU qui avait cet ID avant (c'est complexe sans persistence DB)
              // Simplification: On envoie l'update tel quel, le client gère l'affichage

              // Pour faire simple : on renvoie tout l'historique territory au joueur qui revient
              // Mais comme on ne stocke pas l'historique des coups, on itère sur la map
            }
          });

          // Force update scores
          io.to(roomCode).emit("territory_update", {
            index: -1, // Dummy index juste pour update score
            value: 0,
            ownerId: null,
            color: null,
            scores: room.players.map((p) => ({ id: p.id, score: p.score })),
          });

          // Pour repeindre la grille du joueur reconnecté, on doit lui renvoyer toutes les cases prises
          // Le plus simple est de lui dire : "Voici la map actuelle"
          for (let i = 0; i < 81; i++) {
            if (room.territoryMap[i]) {
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
        } else {
          // Speedrun : renvoyer les barres de progression
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
        // Si on est encore dans le lobby
        io.to(roomCode).emit("update_lobby", {
          players: room.players,
          mode: room.mode,
          difficulty: room.difficulty,
          hostId: room.host,
        });
      }
      return; // Fin de la logique de reconnexion
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

  // ACTION EXPLICITE "Quitter" (Bouton Croix ou Quitter)
  socket.on("leave_room", (roomCode) => {
    leaveRoomLogic(socket, roomCode, true); // true = force remove
  });

  // DÉCONNEXION INVOLONTAIRE (Refresh / Fermeture onglet)
  socket.on("disconnect", () => {
    for (const code in rooms) {
      const room = rooms[code];
      if (room.players.find((p) => p.id === socket.id)) {
        leaveRoomLogic(socket, code, false); // false = soft disconnect
        break;
      }
    }
  });

  function leaveRoomLogic(socket, roomCode, forceRemove) {
    const room = rooms[roomCode];
    if (!room) return;

    // Si la partie est en cours ET que ce n'est pas un départ volontaire ("Quitter"),
    // on garde le joueur dans la liste pour qu'il puisse se reconnecter.
    if (room.state === "playing" && !forceRemove) {
      // On ne fait rien, on attend son retour.
      // Optionnel : on pourrait marquer le joueur comme "offline" pour l'afficher grisé
      return;
    }

    const playerIndex = room.players.findIndex((p) => p.id === socket.id);
    const wasHost = room.host === socket.id;
    const playerName =
      playerIndex !== -1 ? room.players[playerIndex].username : "Un joueur";

    // Suppression définitive
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

    const totalEmpty = room.gameData.initial.filter((x) => x === 0).length;

    if (room.mode === "territory") room.territoryMap = new Array(81).fill(null);

    io.to(roomCode).emit("game_started", {
      initial: room.gameData.initial,
      players: room.players,
      totalEmpty: totalEmpty,
    });
  });

  socket.on("submit_move", ({ roomCode, index, value }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== "playing") return;

    const correctValue = room.gameData.solution[index];
    const isCorrect = value === correctValue;
    // On cherche par Socket ID, mais attention aux mises à jour d'ID lors de la reco
    // Idéalement on utiliserait un UserID stable, mais ici on update l'ID dans l'objet player
    const player = room.players.find((p) => p.id === socket.id);

    if (!player) return;

    if (room.mode === "speedrun") {
      // ...
    } else if (room.mode === "territory") {
      if (isCorrect && room.territoryMap[index] === null) {
        room.territoryMap[index] = socket.id; // On stocke le socket ID actuel
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
