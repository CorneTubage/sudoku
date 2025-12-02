let socket;
try {
  socket = io();
} catch (e) {
  console.warn("Socket.io non détecté.");
  socket = { on: () => {}, emit: () => {} };
}

const app = {
  currentMode: "solo",
  roomCode: null,
  username: "Joueur",
  myId: null,
  myColor: "#86efac",

  init: () => {
    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get("room");
    const urlUser = params.get("user");

    if (urlRoom && urlUser) {
      document.getElementById("username").value = urlUser;
      // On lance la connexion automatiquement
      app.joinRoom(urlRoom);
    }
  },

  updateUrl: () => {
    if (app.roomCode && app.username) {
      const url = new URL(window.location);
      url.searchParams.set("room", app.roomCode);
      url.searchParams.set("user", app.username);
      window.history.pushState({}, "", url);
    } else {
      const url = new URL(window.location);
      url.searchParams.delete("room");
      window.history.pushState({}, "", url);
    }
  },

  showScreen: (id) => {
    document
      .querySelectorAll(".screen")
      .forEach((s) => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
    const modal = document.getElementById("solo-win-modal");
    if (modal) modal.classList.add("hidden");
    const resumeModal = document.getElementById("resume-modal");
    if (resumeModal) resumeModal.classList.add("hidden");
  },

  showRules: () => {
    app.showScreen("screen-rules");
  },
  showSoloDifficulty: () => {
    app.showScreen("screen-difficulty");
  },

  updateControls: () => {
    const isTerritory = app.currentMode === "territory";
    const toggle = (id, hide) => {
      const el = document.getElementById(id);
      if (el) {
        if (hide) el.classList.add("hidden");
        else el.classList.remove("hidden");
      }
    };
    toggle("btn-undo", isTerritory);
    toggle("btn-erase", isTerritory);
    toggle("btn-reset", isTerritory);
  },

  handleSoloClick: () => {
    const saved = localStorage.getItem("sudoku_solo_save");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        const hasMoves = data.board.some(
          (val, idx) => val !== data.initial[idx]
        );
        if (hasMoves) {
          const diffLabel = {
            easy: "Facile",
            medium: "Moyen",
            hard: "Difficile",
          };
          document.getElementById("resume-diff").innerText =
            diffLabel[data.difficulty] || "Moyen";
          document.getElementById("resume-modal").classList.remove("hidden");
          return;
        }
      } catch (e) {
        localStorage.removeItem("sudoku_solo_save");
      }
    }
    app.showSoloDifficulty();
  },

  resumeSoloGame: () => {
    const saved = localStorage.getItem("sudoku_solo_save");
    if (saved) {
      const data = JSON.parse(saved);
      app.currentMode = "solo";
      app.myColor = "#86efac";
      document.documentElement.style.setProperty("--user-color", app.myColor);
      app.showScreen("screen-game");
      document.getElementById("multi-hud").classList.add("hidden");
      document.getElementById("mode-display").innerText =
        "Mode Solo (" + (data.difficulty || "Reprise") + ")";
      document.getElementById("btn-pause").classList.remove("hidden");

      app.updateControls();
      game.loadSavedGame(data);
    } else {
      app.showSoloDifficulty();
    }
  },

  startSolo: (difficulty = "medium") => {
    app.currentMode = "solo";
    app.myColor = "#86efac";
    document.documentElement.style.setProperty("--user-color", app.myColor);
    app.showScreen("screen-game");
    document.getElementById("multi-hud").classList.add("hidden");
    document.getElementById("mode-display").innerText =
      "Mode Solo (" + difficulty + ")";
    document.getElementById("btn-pause").classList.remove("hidden");

    const url = new URL(window.location);
    url.searchParams.delete("room");
    window.history.pushState({}, "", url);

    app.updateControls();
    game.initSolo(difficulty);
  },

  createRoom: (mode) => {
    const name = document.getElementById("username").value || "Joueur";
    app.username = name;
    socket.emit("create_room", { username: name, mode: mode });
  },

  joinRoomFromInput: () => {
    const code = document.getElementById("room-code-input").value.toUpperCase();
    if (!code) return alert("Entrez un code !");
    app.joinRoom(code);
  },

  joinRoom: (code) => {
    const name = document.getElementById("username").value || "Joueur";
    app.username = name;
    socket.emit("join_room", { roomCode: code, username: name });
  },

  setLobbyDifficulty: (diff) => {
    if (app.roomCode) {
      socket.emit("change_difficulty", {
        roomCode: app.roomCode,
        difficulty: diff,
      });
    }
  },

  leaveLobby: () => {
    if (app.roomCode) {
      socket.emit("leave_room", app.roomCode);
      app.roomCode = null;
      app.updateUrl();
      app.showScreen("screen-menu");
    }
  },

  socketStartGame: () => {
    socket.emit("start_game", app.roomCode);
  },

  quitGame: () => {
    if (confirm("Quitter la partie ?")) {
      if (app.roomCode) {
        socket.emit("leave_room", app.roomCode);
      }
      app.updateUrl();
      location.reload();
    }
  },
};

// --- SOCKET EVENTS ---

socket.on("room_created", (code) => {
  app.roomCode = code;
  app.joinRoom(code);
});

socket.on("joined_success", (data) => {
  app.roomCode = data.roomCode;
  app.currentMode = data.mode;
  app.myId = data.playerId;

  app.myColor = data.color || "#86efac";
  document.documentElement.style.setProperty("--user-color", app.myColor);

  document.getElementById("display-room-code").innerText = data.roomCode;
  app.updateUrl();
  app.showScreen("screen-lobby");
});

socket.on("update_lobby", (data) => {
  const list = document.getElementById("lobby-player-list");
  list.innerHTML = "";
  data.players.forEach((p) => {
    const li = document.createElement("li");
    li.className =
      "flex items-center gap-2 bg-slate-50 p-2 rounded justify-between";
    li.innerHTML = `
            <div class="flex items-center gap-2">
                <div class="w-3 h-3 rounded-full" style="background:${
                  p.color
                }"></div> 
                <span class="font-bold text-slate-700">${p.username}</span>
            </div>
            ${
              data.hostId === p.id
                ? '<span class="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded font-bold">HÔTE</span>'
                : ""
            }
        `;
    list.appendChild(li);
  });

  const iAmHost = app.myId === data.hostId;
  if (iAmHost) {
    document.getElementById("host-controls").classList.remove("hidden");
    document.getElementById("guest-waiting").classList.add("hidden");
    document
      .getElementById("host-difficulty-controls")
      .classList.remove("hidden");
    document.getElementById("guest-difficulty-display").classList.add("hidden");

    document.querySelectorAll(".diff-btn").forEach((btn) => {
      btn.classList.remove("ring-2", "ring-slate-400");
      if (btn.dataset.diff === data.difficulty)
        btn.classList.add("ring-2", "ring-slate-400");
    });
  } else {
    document.getElementById("host-controls").classList.add("hidden");
    document.getElementById("guest-waiting").classList.remove("hidden");
    document.getElementById("host-difficulty-controls").classList.add("hidden");
    document
      .getElementById("guest-difficulty-display")
      .classList.remove("hidden");

    const labels = { easy: "Facile", medium: "Moyen", hard: "Difficile" };
    document.getElementById("guest-difficulty-display").innerText =
      labels[data.difficulty] || data.difficulty;
  }
});

socket.on("game_started", (data) => {
  app.showScreen("screen-game");
  document.getElementById("multi-hud").classList.remove("hidden");
  document.getElementById("btn-pause").classList.add("hidden");

  let modeName =
    app.currentMode === "speedrun" ? "Course" : "Guerre de Territoire";
  document.getElementById(
    "mode-display"
  ).innerText = `Multijoueur : ${modeName}`;

  app.updateControls();

  if (data.players) {
    if (app.currentMode === "territory")
      updateHudScores(data.players.map((p) => ({ id: p.id, score: 0 })));
    else
      updateHudProgress(data.players.map((p) => ({ id: p.id, progress: 0 })));
  }

  game.initMultiplayer(data.initial, data.players, data.totalEmpty);
});

socket.on("player_left_game", (data) => {
  const hud = document.getElementById("players-hud");
  const notif = document.createElement("div");
  notif.className =
    "text-xs text-red-500 font-bold bg-white p-1 rounded shadow mb-1";
  notif.innerText = `${data.username} a quitté.`;
  hud.prepend(notif);
  setTimeout(() => notif.remove(), 5000);

  game.players = game.players.filter((p) => p.id !== data.id);
  if (game.lastScores) updateHudScores(game.lastScores);
});

socket.on("territory_update", (data) => {
  // Si index est -1, c'est juste un update de score, pas de grille
  if (data.index !== -1) {
    game.updateTerritory(data);
  }
  game.lastScores = data.scores;
  updateHudScores(data.scores);
});

socket.on("territory_penalty", (data) => {
  game.lastScores = data.scores;
  updateHudScores(data.scores);
  game.shakeCell(data.index);
});

socket.on("progress_update", (playersData) => {
  updateHudProgress(playersData);
});

socket.on("game_over", (data) => {
  game.stopTimer();

  if (data.fullGrid) {
    game.board = data.fullGrid;
    game.renderGrid();
  }

  alert(`Partie terminée ! Vainqueur : ${data.winner}`);
  setTimeout(() => location.reload(), 5000);
});

socket.on("error", (msg) => alert(msg));

// --- UI UPDATES ---

function updateHudScores(scores) {
  const hud = document.getElementById("players-hud");
  const notifs = Array.from(hud.querySelectorAll(".text-red-500"));
  hud.innerHTML = "";
  notifs.forEach((n) => hud.appendChild(n));

  scores
    .sort((a, b) => b.score - a.score)
    .forEach((s) => {
      const player = game.players.find((p) => p.id === s.id);
      if (player) {
        const div = document.createElement("div");
        div.className = "flex justify-between";
        div.innerHTML = `<span style="color:${player.color}">${player.username}</span> <span>${s.score} pts</span>`;
        hud.appendChild(div);
      }
    });
}

function updateHudProgress(players) {
  const hud = document.getElementById("players-hud");
  const notifs = Array.from(hud.querySelectorAll(".text-red-500"));
  hud.innerHTML = "";
  notifs.forEach((n) => hud.appendChild(n));

  players
    .sort((a, b) => b.progress - a.progress)
    .forEach((p) => {
      const div = document.createElement("div");
      const playerObj = game.players.find((pl) => pl.id === p.id);
      if (playerObj) {
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
      }
    });
}

// --- GAME LOGIC ---

class SudokuLogic {
  constructor() {
    this.grid = new Array(81).fill(0);
  }

  generate(difficulty) {
    let g = new Array(81).fill(0);
    this.fillBox(g, 0, 0);
    this.fillBox(g, 3, 3);
    this.fillBox(g, 6, 6);
    this.fillGrid(g);
    let s = [...g];

    let attempts;
    if (difficulty === "easy") attempts = 30;
    else if (difficulty === "hard") attempts = 55;
    else attempts = 45;

    let k = attempts;
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
  isValid(grid, row, col, num) {
    for (let x = 0; x < 9; x++) if (grid[row * 9 + x] === num) return false;
    for (let x = 0; x < 9; x++) if (grid[x * 9 + col] === num) return false;
    let sr = row - (row % 3),
      sc = col - (col % 3);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        if (grid[(sr + i) * 9 + (sc + j)] === num) return false;
    return true;
  }

  validateFullGrid(grid) {
    if (grid.includes(0)) return false;
    for (let i = 0; i < 9; i++) {
      let row = new Set(),
        col = new Set(),
        box = new Set();
      for (let j = 0; j < 9; j++) {
        let rVal = grid[i * 9 + j];
        let cVal = grid[j * 9 + i];
        let bVal =
          grid[
            (Math.floor(i / 3) * 3 + Math.floor(j / 3)) * 9 +
              (i % 3) * 3 +
              (j % 3)
          ];

        if (row.has(rVal) || col.has(cVal) || box.has(bVal)) return false;
        row.add(rVal);
        col.add(cVal);
        box.add(bVal);
      }
    }
    return true;
  }
}

class Game {
  constructor() {
    this.localLogic = new SudokuLogic();
    this.board = [];
    this.initial = [];
    this.solution = [];
    this.notes = {};
    this.history = [];
    this.selectedCellIndex = null;
    this.isNoteMode = false;
    this.players = [];
    this.isPaused = false;
    this.timerSeconds = 0;
    this.timerInterval = null;
    this.lastScores = null;
    this.difficulty = "medium";
    this.cellColors = [];
    this.totalEmptyStart = 0;

    this.gridEl = document.getElementById("grid-container");
    this.gridEl.addEventListener("click", (e) => {
      const cell = e.target.closest(".cell");
      if (cell) this.selectCell(parseInt(cell.dataset.index));
    });

    document.addEventListener("keydown", (e) => {
      if (this.isPaused) return;
      const key = e.key;
      if (key >= "1" && key <= "9") this.handleInput(parseInt(key));
      else if (key === "Backspace" || key === "Delete") this.handleInput(0);
      else if (key.toLowerCase() === "n") this.toggleNoteMode();
      else if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === "z") {
        e.preventDefault();
        this.undo();
      } else if (key.startsWith("Arrow")) this.moveSelection(key);
    });
  }

  moveSelection(key) {
    if (this.selectedCellIndex === null) {
      this.selectCell(0);
      return;
    }
    let newIdx = this.selectedCellIndex;
    if (key === "ArrowUp") newIdx -= 9;
    if (key === "ArrowDown") newIdx += 9;
    if (key === "ArrowLeft") newIdx -= 1;
    if (key === "ArrowRight") newIdx += 1;
    if (newIdx >= 0 && newIdx < 81) this.selectCell(newIdx);
  }

  saveLocalGame() {
    if (app.currentMode !== "solo") return;
    const data = {
      board: this.board,
      initial: this.initial,
      solution: this.solution,
      notes: this.notes,
      timer: this.timerSeconds,
      difficulty: this.difficulty,
    };
    localStorage.setItem("sudoku_solo_save", JSON.stringify(data));
  }

  loadSavedGame(data) {
    this.board = data.board;
    this.initial = data.initial;
    this.solution = data.solution;
    this.notes = data.notes;
    this.difficulty = data.difficulty;
    this.history = [];
    this.cellColors = new Array(81).fill(null);

    this.timerSeconds = data.timer || 0;
    this.isPaused = false;
    this.renderGrid();
    this.startTimer(this.timerSeconds);
  }

  initSolo(difficulty) {
    this.difficulty = difficulty;
    const data = this.localLogic.generate(difficulty);
    this.initial = [...data.initial];
    this.board = [...data.initial];
    this.solution = [...data.solution];
    this.notes = {};
    this.history = [];
    this.cellColors = new Array(81).fill(null);
    this.isPaused = false;

    localStorage.removeItem("sudoku_solo_save");

    this.renderGrid();
    this.startTimer();
    this.saveLocalGame();
  }

  initMultiplayer(initialGrid, playersList, totalEmpty) {
    this.initial = [...initialGrid];
    this.board = [...initialGrid];
    this.solution = null;
    this.players = playersList;
    this.notes = {};
    this.history = [];
    this.cellColors = new Array(81).fill(null);
    this.totalEmptyStart = totalEmpty || 81;
    this.isPaused = false;
    this.renderGrid();
    this.startTimer();
  }

  startTimer(startAt = 0) {
    this.stopTimer();
    this.timerSeconds = startAt;
    document.getElementById("timer").innerText = this.formatTime(
      this.timerSeconds
    );
    this.timerInterval = setInterval(() => {
      if (!this.isPaused) {
        this.timerSeconds++;
        document.getElementById("timer").innerText = this.formatTime(
          this.timerSeconds
        );
        if (this.timerSeconds % 5 === 0) this.saveLocalGame();
      }
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
  }

  togglePause() {
    if (app.currentMode !== "solo") return;
    this.isPaused = !this.isPaused;
    const btn = document.getElementById("btn-pause");
    if (this.isPaused) {
      this.gridEl.style.opacity = "0";
      btn.innerText = "REPRENDRE";
      document.getElementById("timer").innerText = "PAUSE";
    } else {
      this.gridEl.style.opacity = "1";
      btn.innerText = "PAUSE";
      document.getElementById("timer").innerText = this.formatTime(
        this.timerSeconds
      );
    }
  }

  formatTime(s) {
    const m = Math.floor(s / 60)
      .toString()
      .padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  }

  resetBoard() {
    if (app.currentMode === "territory")
      return alert("Impossible de reset en mode Territoire !");
    if (confirm("Voulez-vous recommencer cette grille à zéro ?")) {
      this.board = [...this.initial];
      this.notes = {};
      this.history = [];
      this.renderGrid();
      if (app.currentMode === "solo") this.saveLocalGame();
      if (app.currentMode === "speedrun") this.checkProgress();
    }
  }

  undo() {
    if (this.history.length === 0) return;
    const lastState = this.history.pop();
    this.board = [...lastState.board];
    this.notes = JSON.parse(JSON.stringify(lastState.notes));
    this.renderGrid();
    if (app.currentMode === "solo") this.saveLocalGame();
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
      }

      if (app.currentMode === "territory" && this.cellColors[i]) {
        cell.style.backgroundColor = this.cellColors[i];
        cell.style.borderColor = this.cellColors[i];
        cell.classList.add("owned");
        cell.classList.remove("user-input");
      }

      if (this.board[i] === 0 && this.notes[i] && this.notes[i].length > 0) {
        const noteGrid = document.createElement("div");
        noteGrid.className = "note-grid";
        for (let n = 1; n <= 9; n++) {
          const span = document.createElement("span");
          span.className = "note-num";
          if (this.notes[i].includes(n)) span.textContent = n;
          noteGrid.appendChild(span);
        }
        cell.appendChild(noteGrid);
      }
      this.gridEl.appendChild(cell);
    }
    this.updateHighlights();
  }

  selectCell(index) {
    if (this.isPaused) return;
    this.selectedCellIndex = index;
    this.updateHighlights();
  }

  updateHighlights() {
    document
      .querySelectorAll(".cell")
      .forEach((c) =>
        c.classList.remove(
          "selected",
          "highlighted",
          "same-number",
          "highlighted-box"
        )
      );
    if (this.selectedCellIndex === null) return;

    const cell = document.querySelector(
      `.cell[data-index='${this.selectedCellIndex}']`
    );
    if (cell) cell.classList.add("selected");

    const row = Math.floor(this.selectedCellIndex / 9);
    const col = this.selectedCellIndex % 9;
    const boxStartRow = row - (row % 3);
    const boxStartCol = col - (col % 3);
    const val = this.board[this.selectedCellIndex];

    document.querySelectorAll(".cell").forEach((c) => {
      const idx = parseInt(c.dataset.index);
      const r = Math.floor(idx / 9);
      const co = idx % 9;

      if (r === row || co === col) c.classList.add("highlighted");

      if (
        r >= boxStartRow &&
        r < boxStartRow + 3 &&
        co >= boxStartCol &&
        co < boxStartCol + 3
      ) {
        c.classList.add("highlighted");
      }

      if (val !== 0 && (this.board[idx] === val || this.initial[idx] === val))
        c.classList.add("same-number");
    });
  }

  toggleNoteMode() {
    this.isNoteMode = !this.isNoteMode;
    const ind = document.getElementById("note-indicator");
    ind.className = this.isNoteMode
      ? "w-10 h-10 rounded-full bg-green-600 text-white flex items-center justify-center text-lg shadow-sm"
      : "w-10 h-10 rounded-full bg-white/20 backdrop-blur border border-white/30 flex items-center justify-center text-lg shadow-sm";
  }

  handleInput(num) {
    if (this.isPaused) return;
    if (this.selectedCellIndex === null) return;
    if (this.initial[this.selectedCellIndex] !== 0) return;

    this.history.push({
      board: [...this.board],
      notes: JSON.parse(JSON.stringify(this.notes)),
    });
    if (this.history.length > 20) this.history.shift();

    if (app.currentMode !== "solo") {
      if (
        app.currentMode === "territory" &&
        this.board[this.selectedCellIndex] !== 0
      )
        return;

      if (num !== 0 && !this.isNoteMode) {
        socket.emit("submit_move", {
          roomCode: app.roomCode,
          index: this.selectedCellIndex,
          value: num,
        });
        if (app.currentMode === "speedrun") {
          this.board[this.selectedCellIndex] = num;
          this.notes[this.selectedCellIndex] = [];
          this.renderGrid();
          this.checkProgress();
        }
      } else if (this.isNoteMode) {
        this.toggleNoteNumber(num);
        this.renderGrid();
      } else if (num === 0) {
        if (app.currentMode === "territory") return;
        this.board[this.selectedCellIndex] = 0;
        this.renderGrid();
      }
      return;
    }

    if (this.isNoteMode) {
      this.toggleNoteNumber(num);
    } else {
      this.board[this.selectedCellIndex] = num;
      this.notes[this.selectedCellIndex] = [];
      if (num === 0) this.board[this.selectedCellIndex] = 0;

      this.saveLocalGame();
      if (this.localLogic.validateFullGrid(this.board)) {
        this.triggerSoloWin();
      }
    }
    this.renderGrid();
  }

  toggleNoteNumber(num) {
    if (num === 0) {
      this.notes[this.selectedCellIndex] = [];
      return;
    }
    if (!this.notes[this.selectedCellIndex])
      this.notes[this.selectedCellIndex] = [];
    const idx = this.notes[this.selectedCellIndex].indexOf(num);
    if (idx > -1) this.notes[this.selectedCellIndex].splice(idx, 1);
    else this.notes[this.selectedCellIndex].push(num);

    if (app.currentMode === "solo") this.saveLocalGame();
  }

  updateTerritory(data) {
    this.board[data.index] = data.value;
    this.cellColors[data.index] = data.color;

    const cell = document.querySelector(`.cell[data-index='${data.index}']`);
    if (cell) {
      cell.textContent = data.value;
      cell.classList.remove("user-input");
      cell.classList.add("owned", "animate-pop");
      cell.style.backgroundColor = data.color;
      cell.style.borderColor = data.color;
    }
  }

  shakeCell(index) {
    const cell = document.querySelector(`.cell[data-index='${index}']`);
    if (cell) {
      cell.classList.add("animate-shake");
      setTimeout(() => cell.classList.remove("animate-shake"), 300);
    }
  }

  checkProgress() {
    let currentEmpty = this.board.filter((x) => x === 0).length;
    let filledByUser = this.totalEmptyStart - currentEmpty;

    if (this.totalEmptyStart === 0) this.totalEmptyStart = 1;

    let percent = (filledByUser / this.totalEmptyStart) * 100;
    if (percent > 100) percent = 100;
    if (percent < 0) percent = 0;

    socket.emit("update_progress", {
      roomCode: app.roomCode,
      progress: percent,
    });
  }

  triggerSoloWin() {
    this.stopTimer();
    localStorage.removeItem("sudoku_solo_save");
    const modal = document.getElementById("solo-win-modal");
    if (modal) modal.classList.remove("hidden");
    else alert("Gagné !");
  }
}

const game = new Game();
app.init();
