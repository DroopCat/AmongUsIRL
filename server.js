const readline = require('readline');
const WebSocket = require("ws");
const express = require("express");
const fs = require("fs");
var https = require("https");
const { SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS } = require('constants');
const app = express();

const rl = readline.createInterface(process.stdin);

// game variables
var wsCounter = 0;
var game = {
  code:"pigcow",
  partyIP:"192.168.100.100",
  state:"lobby",
  players:[],
  meetingPlayerList:[],
  meetingTimeout:null,
  meetingInProgress:false,
  meetingData:{},
  taskProgress:0,
  settings:{
    impostors:1,
    killCooldown:20,
    voteTime:60,
    meetingTime:60,
    tasks:7,
    emgmtgs:2,
  },
};

// game variable standard
var defaultPlayer = {
  wsid:1,
  username:"borked",
  gameData:{
    tasks:[],
    impostor:false,
    emgmtgs:2,
    uid:"this is not used yet",
    votedFor:"",
    dead:false,
  },
  uid:"borked",
};

// var task = {
//   compleated:false,
// };

var possibleTasks = [
  { name:"empty trash", place:"Cafe", length:"short", code:1 },
  { name:"swipe card", place:"Admin", length:"short", code:2 },
  { name:"fix wiring", place:"Storage", length:"medium", code:3 },
  { name:"submit scan", place:"Medbay", length:"medium", code:4 },
  { name:"Calibrate Distibutor", place:"Electrical", length:"long", code:5 },
  { name:"divert power", place:"Electrical", length:"short", code:6 },
  { name:"attack cat", place:"Back door", length:"short", code:7 },
  { name:"check rat trap", place:"Basement", length:"short", code:8 },
];

app.use(express.static("public"));
const httpsServer = https.createServer(
  {
    key: fs.readFileSync("certs/server.key"),
    cert: fs.readFileSync("certs/server.cert"),
  },
  app
);
const wss = new WebSocket.Server({ server: httpsServer });
httpsServer.listen(3000, () => {
  console.log("Listening at https://localhost:3000/");
});

wss.on("connection", (ws) => {
  //console.log("New ws connection");
  ws.id = wsCounter;
  wsCounter = wsCounter + 1;
  var player;
  ws.on("message", (data)=>{
    var message;
    try {
      message = JSON.parse(data);
    } catch (e) {
      console.log(e);
      message = {
        msgType:"bruh"
      };
    }
    
    //console.log(data);
    if (player == null) {
      if (message.msgType == "join") {
        //game = findGame(message.code);
        let joinWasDenied = false;
        var uidMatchIndex = -1;
        if (message.uid) {
          uidMatchIndex = game.players.findIndex((user)=>{
            return user.uid == message.uid;
          });
        }
        if (uidMatchIndex != -1) { // If they have a familiar name, reconnect
          console.log("attempting reconnect...");
          // todo: verify that the user is disconnected before reconnecting
          player = game.players[uidMatchIndex];
          player.wsid = ws.id;
          ws.send(JSON.stringify({ "msgType":"updatePlayer", "uid":player.uid, "username":player.username }));

        } else if (game.state == "lobby") { // Add a new player
          console.log(`adding new player ${message.username}...`);
          player = JSON.parse(JSON.stringify(defaultPlayer));
          player.wsid = ws.id;
          player.username = message.username;
          player.uid = uuidv4();
          game.players.push(player);
          ws.send(JSON.stringify({ "msgType":"updatePlayer", "uid":player.uid, "username":player.username }));

        } else { // they ain't familiar
          console.log("Join Denied");
          joinWasDenied = true;
          ws.send(JSON.stringify({ "msgType":"joinDenied", "reason":"Game already started" }));
        }

        if (!joinWasDenied) {
          ws.send(JSON.stringify({"msgType":"joinAccepted", "gameState":game.state}));
        }
      } else if (message.msgType == "probe") {
        // find game
        let probeResponse = {
          "msgType":"probeResponse",
          "gameState":game.state,
        };
        if (message.uid) {
          let bruh = game.players.find(player=>{
            return player.uid == message.uid;
          });
          if (bruh != undefined) {
            probeResponse.uidMatch = true;
          } else {
            probeResponse.uidMatch = false;
          }
        }
        ws.send(JSON.stringify(probeResponse));
      }
    } else if (message.msgType == "syncRequest") {
      syncPlayer(player, game);
    } else {
      handlePlayerMessage(message, player, game);
    }
  });

  ws.on("close", ()=>{ // remove players on disconnect
    if (game.state != "lobby") {
      // setTimeout(()=>{
      //   if (ws.readyState == WebSocket.CLOSED) {
      //     if (player != null) {
      //       let playerIndex = game.players.findIndex((user)=>{
      //         return user.wsid == player.wsid;
      //       });
      //       game.players.splice(playerIndex, 1);
      //     }
      //   }
      // }, 10000);
    } else {
      if (player != null) {
        let playerIndex = game.players.findIndex((user)=>{
          return user.wsid == player.wsid;
        });
        game.players.splice(playerIndex, 1);
      }
    }
  });
});

function findGame(gameID) { // TODO: accually find the game
  return game;
}

// game functions

function syncPlayer(player, game) {
  let data = JSON.parse(JSON.stringify(player.gameData));
  data.taskProgress = game.taskProgress;
  data.gameState = game.state;
  data.meetingInProgress = game.meetingInProgress;
  data.meetingData = game.meetingData;
  sendToSocketID(player.wsid, JSON.stringify( {"msgType":"sync", "data":data} ));
}

function handlePlayerMessage(message, player, game) {
  switch (message.msgType) {
    case "taskCompleted":
      compleateTask(message.uid, player);
      break;
    case "killed":
      console.log("someone died.")
      player.gameData.dead = true;
      setTimeout(() => {
        didSomeoneWin(game.players);
      }, 500);
      broadcastToPlayers(game.players, JSON.stringify({"msgType":"NOKILLINGBOIS", "cooldown":game.settings.killCooldown}));
      setTimeout(()=>{
        broadcastToPlayers(game.players, JSON.stringify({"msgType":"goodToKillNow"}));
      }, game.settings.killCooldown*1000);
      break;
    case "report":
      console.log("Report!");
      startMeeting("report", player, game);
      break;
    case "emergency":
      console.log("Emergency!");
      startMeeting("emergency", player, game);
      break;
    case "vote":
      console.log(`${player.username} voted.`);
      player.gameData.votedFor = message.player;
      setTimeout(()=>{
        didEveryoneVote(game);
      }, 500);
      broadcastToPlayers(game.players, JSON.stringify({"msgType":"playerVoted", "player":player.uid}));
      break;
  }
}

function startMeeting (meetingType, chairman, game) {
  if (!game.meetingInProgress) {
    console.log("----------------");
    console.log("Meeting started.");
    console.log("----------------");
    game.meetingInProgress = true; // meeting flag

    // create alternate player list for meeting (should be refactored out)
    let players = [];
    game.players.forEach(player => {
      player.gameData.votedFor = "";
      let data = {
        "playerName":player.username,
        "playerUID":player.uid,
        "dead":player.gameData.dead,
        "hasVoted":false,
        "votes":0,
      };
      players.push(data);
    });

    // send start meeting message to players
    let message = {
      "msgType":"meeting",
      "meetingType":meetingType,
      "meetingTime":game.settings.meetingTime,
      "chairman":chairman.uid,
      "players":players,
    };
    game.meetingData = message;
    broadcastToPlayers(game.players, JSON.stringify(message));

    game.meetingPlayerList = players; // save player list

    // set the timer
    game.meetingTimeout = setTimeout(() => {
      if (game.meetingInProgress) {
        console.log("Meeting timer.")
        endMeeting(players);
      }
    }, game.settings.meetingTime*1000);
  } else {
    console.log("Meeting already started.");
  }
}

function didEveryoneVote() {
  let peopleThatVoted = 0;
  let peopleThatAreAlive = 0;
  game.players.forEach((player)=>{
    if (player.gameData.votedFor != "") {
      peopleThatVoted = peopleThatVoted + 1;
    }
    if (player.gameData.dead == false) {
      peopleThatAreAlive = peopleThatAreAlive + 1;
    }
  });
  if (peopleThatVoted == peopleThatAreAlive) {
    console.log("Everyone has voted.");
    if (game.meetingInProgress) {
      endMeeting(game.meetingPlayerList);
    }
  }
}

function endMeeting(meetingPlayerList) {
  console.log("----------------");
  console.log("Meeting ended.");
  console.log("----------------");
  game.meetingInProgress = false; // clear meeting flag

  try {
    clearTimeout(game.meetingTimeout);
  } catch (e) {
    console.log(e);
  }
  // tally up the votes
  let mostVotedPlayer = {};
  let secondMostVotedPlayer = "bruh";
  let peopleThatSkipped = 0;
  let peopleWhoAreNotDead = 0;

  game.players.forEach((player)=>{
    if (!player.gameData.dead) { // ignore people who are dead
      peopleWhoAreNotDead = peopleWhoAreNotDead + 1;
      // did they skip
      if ((player.gameData.votedFor != "") && (player.gameData.votedFor != "nobody")) {
        // grab the player profile they voted for
        let guilty = meetingPlayerList.find((guiltyPlayer)=>{
          return guiltyPlayer.playerUID == player.gameData.votedFor;
        });
        if (guilty !== undefined) { // Did we find the player?
          guilty.votes = guilty.votes + 1; // make them guiltier
          if (guilty.playerUID !== mostVotedPlayer.playerUID) {
            if (guilty.votes >= (mostVotedPlayer.votes || 0)) { // are they guiltier than the most guilty?
              secondMostVotedPlayer = JSON.parse(JSON.stringify(mostVotedPlayer));
              mostVotedPlayer = guilty; // make them the guiltiest.
            }
          }
        }else{
          console.log("guilty player was undefined, thats not a good sign");
        }
      } else { // if they skipped
        peopleThatSkipped = peopleThatSkipped + 1;
      }
    }
  });

  let secondMostVotes = 0;
  if (secondMostVotedPlayer !== "bruh") {
    secondMostVotes = (secondMostVotedPlayer.votes || 0);
  }

  // now we're finished adding up the votes
  console.log(`${mostVotedPlayer.playerName} had the most votes.`);
  console.log(`MVP: ${mostVotedPlayer.votes}, SMVP: ${secondMostVotes}, SV: ${peopleThatSkipped}`);

  // time to eject someone
  let theKickedUID;
  let wasTheImpostor = false;

  if (mostVotedPlayer == null) {
      console.log("Error: Most voted player was null or undefined");
      theKickedUID = "nobody";
  } else {
    theKickedUID = (mostVotedPlayer.playerUID || "nobody");

    if (peopleThatSkipped > mostVotedPlayer.votes) {
      // Skipped
      console.log("Result: Skipped");
      theKickedUID = "nobody";
    } else if ((secondMostVotes == mostVotedPlayer.votes) || (peopleThatSkipped == mostVotedPlayer.votes)) {
      // Tie
      console.log("Result: Tie");
      theKickedUID = "nobody";
    } else { 
      // kick most voted player
      let votedOutPlayer = game.players.find((player)=>{
        return player.uid == theKickedUID;
      });
      if (votedOutPlayer != undefined) {
        console.log("Result: Player voted out");
        votedOutPlayer.gameData.dead = true;
        wasTheImpostor = votedOutPlayer.gameData.impostor;
      }
    }
  }

  // old voting
  // if (mostVotedPlayer != undefined) {
  //   theKickedUID = (mostVotedPlayer.playerUID || "nobody");
  //   if (theKickedUID != "nobody") {
  //     if (peopleThatSkipped >= mostVotedPlayer.votes) {
  //       theKickedUID = "nobody";
  //       wasTheImpostor = false;
  //     } else {
  //       if (secondMostVotedPlayer !== "bruh") {
  //         secondMostVotes = (secondMostVotedPlayer.votes || 0);
  //       }
  //       if (mostVotedPlayer.votes == secondMostVotes) {
  //         console.log("Tie");
  //         theKickedUID = "nobody";
  //       } else {
  //         let votedOutPlayer = game.players.find((player)=>{
  //           return player.uid == theKickedUID;
  //         });
  //         if (votedOutPlayer != undefined) {
  //           console.log("player voted out");
  //           votedOutPlayer.gameData.dead = true;
  //           wasTheImpostor = votedOutPlayer.gameData.impostor;
  //         }
  //       }
  //     }
  //   } else {
  //     console.log("Was nobody 1");
  //     theKickedUID = "nobody";
  //     wasTheImpostor = false;
  //   }
  // } else {
  //   console.log("Was nobody 2");
  //   theKickedUID = "nobody";
  //   wasTheImpostor = false;
  // }

  broadcastToPlayers(game.players, JSON.stringify({ "msgType":"meetingEnd", "kicked":theKickedUID, "wasImpostor":wasTheImpostor }));
  // set the timer
  setTimeout(() => {
    console.log("checking if someone won...");
    didSomeoneWin(game.players);
  }, 7500);
}

function startGame (gameCode) {
  // find game
  if (game.players.length > 2) {
    console.log(`Starting game ${gameCode}.`);
    game.state = "started"; // set state
    resetGame(game);
    setTimeout(()=>{
      chooseImpostor(game.players); // choose impostor
      assignPlayersTasks(game.players); // assign players tasks
    
      // send game info to all players
      broadcastStart(game.players);
    }, 500);
  } else {
    console.log("Not enough players to start.");
  }
}

function endGame (whoWon) {
  console.log("Game ended.");
  broadcastToPlayers(game.players, JSON.stringify({"msgType":"gameEnded", "winner":whoWon}));
  game.state = "lobby";
}

function resetGame(game) {
  game.meetingData = {};
  game.meetingPlayerList = [];
  game.meetingInProgress = false;
  game.taskProgress = 0;
  game.players.forEach((player)=>{
    player.gameData.impostor = false;
    player.gameData.tasks = [];
    player.gameData.emgmtgs = game.settings.emgmtgs;
    player.gameData.votedFor = "";
    player.gameData.dead = false;
  });
}

function assignPlayersTasks (players) {
  players.forEach((player)=>{
    let assignableTasks = JSON.parse(JSON.stringify(possibleTasks));
    for (let i = 0; i < game.settings.tasks; i++) {
      let index = assignableTasks.length * Math.random() | 0;
      let task = assignableTasks[index];
      assignableTasks.splice(index, 1);
      if (task == null) break;
      task.uid = uuidv4();
      task.done = false;
      player.gameData.tasks.push(task);
    }
  });
}

function chooseImpostor(players) {
  let player = players[players.length * Math.random() | 0];
  player.gameData.impostor = true;
}
function broadcastStart(players) {
  players.forEach(player => {
    let message = {
      "msgType":"startGame",
      "gameData":player.gameData,
    };
    sendToSocketID(player.wsid, JSON.stringify(message));
  });
}

function compleateTask(uid, player) {
  let task = player.gameData.tasks.find((task)=>{
    return task.uid == uid;
  });
  task.done = true;
  updateTaskBar(game); // TODO: use passed down game object instead
}

function didSomeoneWin (players) {
  let whoWon = "nobody";
  let impostors = 0;
  let crewmates = 0;
  players.forEach((player)=>{
    if (!player.gameData.dead) {
      if (player.gameData.impostor) {
        impostors = impostors + 1;
      } else {
        crewmates = crewmates + 1;
      }
    }
  });
  if (crewmates == 0) { // impostors win
    whoWon = "impostors";
  } else if (impostors == 0) { // crewmates win
    whoWon = "crewmates";
  } else if (impostors == 1 && crewmates == 1) { // impostors win
    whoWon = "impostors";
  }
  console.log(`There are ${crewmates} crewmates, and ${impostors} impostor(s).`);
  if (whoWon != "nobody") {
    endGame(whoWon);
  }
}

function updateTaskBar (game) {
  let tasksDone = 0;
  let totalTasks = 0;
  game.players.forEach((player)=>{
    if (!player.gameData.impostor && !player.gameData.dead) {
      player.gameData.tasks.forEach((task)=>{
        if (task.done) {
          tasksDone = tasksDone + 1;
        }
        totalTasks = totalTasks + 1;
      });
    }
  });
  let barValue = ((tasksDone / totalTasks) || 0) * 100;
  game.taskProgress = barValue;
  broadcastToPlayers(game.players, JSON.stringify({ "msgType":"updateTaskBar", "value":barValue }));
  console.log(`Tasks Done: ${tasksDone}/${totalTasks}`);
  if (tasksDone == totalTasks) {
    // we do something
    console.log("Crewmates won from tasks");
    endGame("crewmates");
  }
  return barValue;
}

// Utils

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function broadcastToPlayers (players, message) {
  players.forEach(player => {
    sendToSocketID(player.wsid, message);
  });
}

function sendToSocketID (wsid, message) {
  for (let client of wss.clients) {
    if (client.id == wsid) {
      client.send(message);
      break;
    }
  }
}



rl.on('line', (input) => {
  let commands = input.split(" ");
  switch (commands[0]) {
    case "start":
      if (commands[1]) {
        startGame(commands[1]);
      } else {
        console.log("No game specified");
      }
      break;
    case "stop":
      console.log("stopping game");
      endGame("Nobody won");
      break;
    case "log":
      console.log(game);
      break;
    case "run":
      console.log("Running code");
      console.log(eval(input.slice(4)));
      break;
  }
});
console.log("Ready!");
