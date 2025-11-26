// --- APP MANAGEMENT (SCREENS & SOCKET) ---
const socket = io();

const app = {
  currentMode: "solo", // 'solo', 'speedrun', 'territory'
  roomCode: null,
  username: "Joueur",
  myId: null,

  showScreen: (id) => {
    document
      .querySelectorAll(".screen")
      .forEach((s) => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
  },

  startSolo: () => {
    app.currentMode = "solo";
    app.showScreen("screen-game");
    document.getElementById("multi-hud").classList.add("hidden");
    document.getElementById("mode-display").innerText = "Mode Solo";
    game.initSolo();
  },

  createRoom: (mode) => {
    const name = document.getElementById("username").value || "Joueur";
    app.username = name;
    socket.emit("create_room", { username: name, mode: mode });
  },

  joinRoom: () => {
    const name = document.getElementById("username").value || "Joueur";
    const code = document.getElementById("room-code-input").value.toUpperCase();
    if (!code) return alert("Entrez un code !");
    app.username = name;
    socket.emit("join_room", { roomCode: code, username: name });
  },

  socketStartGame: () => {
    socket.emit("start_game", app.roomCode);
  },

  quitGame: () => {
    if (confirm("Quitter la partie ?")) {
      location.reload();
    }
  },
};

// --- SOCKET EVENTS ---

socket.on("room_created", (code) => {
  app.roomCode = code;
  app.joinRoom(); // Auto join own room
});

socket.on("joined_success", (data) => {
  app.roomCode = data.roomCode;
  app.currentMode = data.mode;
  app.myId = data.playerId;
  document.getElementById("display-room-code").innerText = data.roomCode;
  app.showScreen("screen-lobby");
});

socket.on("update_lobby", (data) => {
  const list = document.getElementById("lobby-player-list");
  list.innerHTML = "";
  data.players.forEach((p) => {
    const li = document.createElement("li");
    li.className = "flex items-center gap-2 bg-slate-50 p-2 rounded";
    li.innerHTML = `<div class="w-3 h-3 rounded-full" style="background:${p.color}"></div> ${p.username}`;
    list.appendChild(li);
  });

  if (data.isHost) {
    document.getElementById("host-controls").classList.remove("hidden");
    document.getElementById("guest-waiting").classList.add("hidden");
  } else {
    document.getElementById("host-controls").classList.add("hidden");
    document.getElementById("guest-waiting").classList.remove("hidden");
  }
});

socket.on("game_started", (data) => {
  app.showScreen("screen-game");
  document.getElementById("multi-hud").classList.remove("hidden");

  let modeName =
    app.currentMode === "speedrun" ? "Course" : "Guerre de Territoire";
  document.getElementById(
    "mode-display"
  ).innerText = `Multijoueur : ${modeName}`;

  game.initMultiplayer(data.initial, data.players);
});

socket.on("territory_update", (data) => {
  // data: { index, value, ownerId, color, scores }
  game.updateTerritory(data);
  updateHudScores(data.scores);
});

socket.on("progress_update", (playersData) => {
  // Met à jour les barres de progression
  updateHudProgress(playersData);
});

socket.on("game_over", (data) => {
  alert(`Partie terminée ! Vainqueur : ${data.winner}`);
  setTimeout(() => location.reload(), 3000);
});

socket.on("error", (msg) => alert(msg));

function updateHudScores(scores) {
  // Affichage simple pour Territoire
  const hud = document.getElementById("players-hud");
  hud.innerHTML = "";
  scores
    .sort((a, b) => b.score - a.score)
    .forEach((s) => {
      const div = document.createElement("div");
      const player = game.players.find((p) => p.id === s.id);
      div.className = "flex justify-between";
      div.innerHTML = `<span style="color:${player.color}">${player.username}</span> <span>${s.score} pts</span>`;
      hud.appendChild(div);
    });
}

function updateHudProgress(players) {
  // Affichage simple pour Speedrun
  const hud = document.getElementById("players-hud");
  hud.innerHTML = "";
  players
    .sort((a, b) => b.progress - a.progress)
    .forEach((p) => {
      const div = document.createElement("div");
      const playerObj = game.players.find((pl) => pl.id === p.id);
      div.className = "mb-1";
      div.innerHTML = `
                <div class="flex justify-between text-xs mb-1"><span style="color:${
                  playerObj.color
                }">${p.username}</span> <span>${Math.round(
        p.progress
      )}%</span></div>
                <div class="h-1 bg-slate-200 rounded-full overflow-hidden">
                    <div class="h-full bg-green-500 transition-all duration-500" style="width: ${
                      p.progress
                    }%"></div>
                </div>
             `;
      hud.appendChild(div);
    });
}

// --- GAME LOGIC (Modified for Multi) ---

class SudokuLogic {
  // Version Solo uniquement, le multi est géré par le serveur
  constructor() {
    this.grid = new Array(81).fill(0);
  }
  isValid(grid, row, col, num) {
    /* ... logique identique ... */
    for (let x = 0; x < 9; x++) if (grid[row * 9 + x] === num) return false;
    for (let x = 0; x < 9; x++) if (grid[x * 9 + col] === num) return false;
    let sr = row - (row % 3),
      sc = col - (col % 3);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        if (grid[(sr + i) * 9 + (sc + j)] === num) return false;
    return true;
  }
  fillGrid(grid) {
    for (let i = 0; i < 81; i++) {
      if (grid[i] === 0) {
        let nums = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5);
        for (let num of nums) {
          if (this.isValid(grid, Math.floor(i / 9), i % 9, num)) {
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
  generate() {
    let g = new Array(81).fill(0);
    this.fillBox(g, 0, 0);
    this.fillBox(g, 3, 3);
    this.fillBox(g, 6, 6);
    this.fillGrid(g);
    let s = [...g];
    let k = 40;
    while (k > 0) {
      let x = Math.floor(Math.random() * 81);
      if (g[x] !== 0) {
        g[x] = 0;
        k--;
      }
    }
    return { initial: g, solution: s };
  }
  fillBox(g, r, c) {
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        let n;
        do {
          n = Math.floor(Math.random() * 9) + 1;
        } while (!this.isSafe(g, r, c, n));
        g[(r + i) * 9 + (c + j)] = n;
      }
  }
  isSafe(g, r, c, n) {
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        if (g[(r + i) * 9 + (c + j)] === n) return false;
    return true;
  }
}

class Game {
  constructor() {
    this.localLogic = new SudokuLogic();
    this.board = [];
    this.initial = [];
    this.solution = []; // Seulement en mode Solo
    this.notes = {};
    this.selectedCellIndex = null;
    this.isNoteMode = false;
    this.players = []; // Multi info

    this.gridEl = document.getElementById("grid-container");
    this.gridEl.addEventListener("click", (e) => {
      const cell = e.target.closest(".cell");
      if (cell) this.selectCell(parseInt(cell.dataset.index));
    });
  }

  initSolo() {
    const data = this.localLogic.generate();
    this.initial = [...data.initial];
    this.board = [...data.initial];
    this.solution = [...data.solution];
    this.notes = {};
    this.renderGrid();
  }

  initMultiplayer(initialGrid, playersList) {
    this.initial = [...initialGrid];
    this.board = [...initialGrid];
    this.solution = null; // On ne connait pas la solution en multi client-side !
    this.players = playersList;
    this.notes = {};
    this.renderGrid();
  }

  renderGrid() {
    this.gridEl.innerHTML = "";
    for (let i = 0; i < 81; i++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.index = i;
      if (this.initial[i] !== 0) {
        cell.classList.add("initial");
        cell.textContent = this.initial[i];
      } else if (this.board[i] !== 0) {
        cell.textContent = this.board[i];
        cell.classList.add("user-input");
        // En solo, on check l'erreur direct. En multi, c'est le serveur qui validera.
        if (app.currentMode === "solo" && this.board[i] !== this.solution[i]) {
          cell.classList.add("error");
        }
      }
      // Notes rendering...
      if (this.board[i] === 0 && this.notes[i]) {
        /* ... */
      }

      this.gridEl.appendChild(cell);
    }
  }

  selectCell(index) {
    this.selectedCellIndex = index;
    document
      .querySelectorAll(".cell")
      .forEach((c) => c.classList.remove("selected"));
    const cell = document.querySelector(`.cell[data-index='${index}']`);
    if (cell) cell.classList.add("selected");
  }

  toggleNoteMode() {
    this.isNoteMode = !this.isNoteMode;
    const ind = document.getElementById("note-indicator");
    ind.className = this.isNoteMode
      ? "w-10 h-10 rounded-full bg-green-600 text-white flex items-center justify-center text-lg shadow-sm"
      : "w-10 h-10 rounded-full bg-white/20 backdrop-blur border border-white/30 flex items-center justify-center text-lg shadow-sm";
  }

  handleInput(num) {
    if (this.selectedCellIndex === null) return;
    if (this.initial[this.selectedCellIndex] !== 0) return;

    // Logique Multi
    if (app.currentMode !== "solo") {
      if (num !== 0 && !this.isNoteMode) {
        // Envoyer le coup au serveur
        socket.emit("submit_move", {
          roomCode: app.roomCode,
          index: this.selectedCellIndex,
          value: num,
        });

        // Optimistic UI pour Speedrun (on affiche en attendant la confirm)
        if (app.currentMode === "speedrun") {
          this.board[this.selectedCellIndex] = num;
          const cell = document.querySelector(
            `.cell[data-index='${this.selectedCellIndex}']`
          );
          cell.textContent = num;
          cell.classList.add("user-input");
          this.checkProgress();
        }
      }
      return;
    }

    // Logique Solo (inchangée)
    if (this.isNoteMode) {
      // Gestion notes...
    } else {
      this.board[this.selectedCellIndex] = num;
      this.renderGrid();
    }
  }

  updateTerritory(data) {
    // data: { index, value, ownerId, color }
    this.board[data.index] = data.value;
    const cell = document.querySelector(`.cell[data-index='${data.index}']`);

    // Animation et mise à jour visuelle
    cell.textContent = data.value;
    cell.classList.remove("user-input");
    cell.classList.add("owned", "animate-pop");
    cell.style.backgroundColor = data.color;
    cell.style.borderColor = data.color;
  }

  checkProgress() {
    // Pour le speedrun, on envoie un % d'avancement
    let filled = this.board.filter((x) => x !== 0).length;
    let total = 81;
    let percent = (filled / total) * 100;
    socket.emit("update_progress", {
      roomCode: app.roomCode,
      progress: percent,
    });
  }
}

const game = new Game();
