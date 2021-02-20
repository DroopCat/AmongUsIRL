/*
    Among Us - In real life
    Made by DroopCat
    https://droopcat.com
*/
window.onload = () => {
    document.getElementById("allowCamera").addEventListener("click", allowCamera);
    document.getElementById("deadbutton").addEventListener("click", killed);
    document.getElementById("skipbutton").addEventListener("click", skip);
}

var defaultGameData = {
    role:"",
    emgmtgs:0,
    tasks:[],
    taskBarProgress:0,
    dead:false,
    voted:false,
    // moved here
    canScan:false,
    gameStarted:false,
    canBeKilled:true,
    meetingData:{},
    selectedPlayerBox:false,
};

// config
var useLocalStorage = false;
var gameCode = "pigcow";

// low level game data
var webSocket;
var wsReconnects = 0;
var qrscanner;
var gameReady = false;
var firstConnection = true;
var syncRequired = false;

var username = "broken boi!";
var uid;
if (useLocalStorage) {
    uid = localStorage.getItem('uid');
}

var gameData = {};

var sound = new Howl({
    src: ['assets/sounds.webm'],
    sprite: {
        kill:[22, 895],
        sabotage:[1668, 1535],
        start:[3920, 3920],
        votescreen:[8713, 3041],
        emergency:[12610, 2041],
        votetext:[15496, 1968],
        impostorwin:[17731, 8118],
        crewmatewin:[27011, 7539],
        voteselect:[35890, 573],
        taskFinish:[36730, 784],
        voted:[38142, 1129],
    }
});

function startGame (message) {
    // setup
    // reset game data for that new-game squeaky-clean perfection
    gameData = Object.assign({}, defaultGameData);

    // set role
    if (message.gameData.impostor) {
        gameData.role = "impostor";
    } else {
        gameData.role = "crewmate";
    }

    // set game information
    gameData.tasks = message.gameData.tasks;
    gameData.emgmtgs = message.gameData.emgmtgs;

    // start the camera
    startCamera();

    initializeGameScreen();


    // reveal the role, and hide the lobby
    revealRole().then(()=>{
        gameData.gameStarted = true;
        gameData.canScan = true;

        // start the game, and hide all the other stuff
        document.getElementById("permissionsmenu").style.display = "none";
        document.getElementById("gameEndScreen").style.display = "none";
        document.getElementById("killscreen").style.display = "none";
        document.getElementById("votescreen").style.display = "none";
        document.getElementById("kickscreen").style.display = "none";
        document.getElementById("lobby").style.display = "none";
    });
}

function startCamera () {
    qrscanner = new Html5Qrcode(/* element id */ "cramerabox");
    let qrConfig = {
        fps: 10,    // Optional frame per seconds for qr code scanning
        qrbox: 250  // Optional if you want bounded box UI
    };
    qrscanner.start({ facingMode: "environment" }, qrConfig,
        code => {
            if (gameData.canScan && (!gameData.dead)) {
                if (code == 'r') {
                    report();
                } else if (code == 'e') {
                    eMeeting();
                } else {
                    startTask(code);
                }
            }
        },
        error => {
            // i dont want no error in my face
        }
    ).catch(err => {
        // Start failed, handle it.
    });
}

function stopCamera() {
    qrscanner.stop().then(ignore => {
        // QR Code scanning is stopped.
      }).catch(err => {
        // Stop failed, handle it.
      });
}

function endGame (winner="nobody") {
    gameData.gameStarted = false;

    if (winner != "nobody") {
        let winnerText = document.getElementById("winner");
        let endScreen = document.getElementById("gameEndScreen");
        if (winner == "impostors") {
            sound.play("impostorwin");
            winnerText.innerText = "Imposters win."
            winnerText.style.color = "red";
        } else if (winner == "crewmates") {
            sound.play('crewmatewin');
            winnerText.innerText = "Crewmates win."
            winnerText.style.color = "blue";
        } else {
            winnerText.innerText = winner;
            winnerText.style.color = "white";
        }
        endScreen.style.display = "flex";
        endScreen.animate(fadeIn, fadeInTiming).finished.then(()=>{
            // do whatever
        });
    }
    stopCamera();
}

function startTask(code) {
    gameData.canScan = false;
    navigator.vibrate(200);
    if (gameData.role != "impostor") {
        let task = gameData.tasks.find((task)=>{
            return (task.code == code) && ((task.done || false) == false);
        });
        if (task != undefined) {
            setTimeout(()=>{
                task.done = true;
                gameData.canScan = true;
                console.log("done task");
                doneTask(task);
            }, 3000);
        } else {
            gameData.canScan = true;
        }
    } else {
        setTimeout(()=>{
            gameData.canScan = true;
        }, 3000);
    }
}

function doneTask (task) {
    sound.play('taskFinish');
    task.done = true;
    updateTaskList();
    webSocket.send(JSON.stringify({ "msgType":"taskCompleted", "uid":task.uid }));
}

function meeting (message) {
    sound.play('votescreen');
    gameData.voted = false;
    gameData.selectedPlayerBox = false;
    gameData.meetingData = message;

    // get the menu ready
    updateMeetingPlayerList();
    let skipbutton = document.getElementById("skipbutton");
    skipbutton.style.display = "grid";

    // start the countdown
    let countdown = gameData.meetingData.meetingTime;
    document.getElementById("votetimer").innerText = `Time left: ${countdown}`;
    gameData.meetingData.ticker = setInterval(()=>{
        if (countdown >= 1) {
            // update countdown
            countdown = countdown - 1;
            document.getElementById("votetimer").innerText = `Time left: ${countdown}`;
        } else {
            clearInterval(gameData.meetingData.ticker);
        }
    }, 1000);

    // play the animation, then show the vote screen
    document.getElementById("votescreen").style.display = "grid";

}

function meetingEnded(kickeduid, wasImpostor) {
    clearInterval(gameData.meetingData.ticker); // just in case
    let kickedName;
    if (kickeduid != "nobody") {
        let kickedPlayer = gameData.meetingData.players.find((guiltyPlayer)=>{
            return guiltyPlayer.playerUID == kickeduid;
        });
        kickedName = kickedPlayer.playerName;
    } else {
        kickedName = "nobody";
    }

    eject(kickedName, wasImpostor).then(()=>{
        document.getElementById("votescreen").style.display = "none";
        if (kickeduid == uid) {
            gameData.dead = true;
            let killScreen = document.getElementById("killscreen");
            killScreen.style.display = "flex";
        } else {
            gameData.canScan = true;
        }
    });
}

function updateMeetingPlayerList () {
    let list = document.getElementById("playerlist");
    let child = list.lastElementChild;
    while (child) { // remove all players
        list.removeChild(child);
        child = list.lastElementChild;
    }
    gameData.meetingData.players.forEach((player)=>{
        let playerBox = document.createElement("div");
        let name = document.createElement("p");
        name.innerText = player.playerName;
        playerBox.setAttribute("playerUID", player.playerUID);
        playerBox.classList.add("player");
        if (player.dead) {
            playerBox.classList.add("dead");
        } else {
            playerBox.setAttribute("onclick", "playerClicked(event)");
        }
        list.appendChild(playerBox);
        playerBox.appendChild(name);

    });
}

function playerClicked(e) {
    if ((!gameData.voted && gameData.selectedPlayerBox == false) && !gameData.dead) {
        sound.play('voteselect');
        gameData.selectedPlayerBox = true;
        let okButton = document.createElement("button");
        let cancelButton = document.createElement("button");
        okButton.innerText = "Vote";
        cancelButton.innerText = "Cancel";
        okButton.setAttribute("onclick", "vote(event)");
        okButton.setAttribute("id", "voteButton");
        cancelButton.setAttribute("onclick", "cancelVote(event)");
        cancelButton.setAttribute("id", "cancelVoteButton");
        if (e.srcElement.nodeName == "DIV") {
            e.srcElement.appendChild(okButton);
            e.srcElement.appendChild(cancelButton);
        } else {
            e.srcElement.parentElement.appendChild(okButton);
            e.srcElement.parentElement.appendChild(cancelButton);
        }

    }
}

function cancelVote(e) {
    console.log("cancel vote");
    let okButton = document.getElementById("voteButton");
    let cancelButton = document.getElementById("cancelVoteButton");
    okButton.remove();
    cancelButton.remove();
    setTimeout(()=>{
        gameData.selectedPlayerBox = false;
    }, 500);
}

function vote (e) {
    if (!gameData.voted) {
        sound.play('voted');
        console.log("voted");
        let theUID = e.srcElement.parentElement.getAttribute("playerUID");
        gameData.voted = true;
        gameData.selectedPlayerBox = false;
        webSocket.send(JSON.stringify({ "msgType":"vote", "player":theUID }));
    }
    let okButton = document.getElementById("voteButton");
    let cancelButton = document.getElementById("cancelVoteButton");
    let skipbutton = document.getElementById("skipbutton");
    skipbutton.style.display = "none";
    okButton.remove();
    cancelButton.remove();

}

function skip() {
    if (!gameData.voted) {
        sound.play('voted');
        console.log("skipped");
        gameData.voted = true;
        gameData.selectedPlayerBox = false;
        webSocket.send(JSON.stringify({ "msgType":"vote", "player":"nobody" }));
    }
    let skipbutton = document.getElementById("skipbutton");
    skipbutton.style.display = "none";
}

function eMeeting () {
    if (gameData.emgmtgs > 0) {
        gameData.canScan = false;
        webSocket.send(JSON.stringify({"msgType":"emergency"}));
        gameData.emgmtgs = gameData.emgmtgs - 1;
    }
}

function report () {
    gameData.canScan = false;
    webSocket.send(JSON.stringify({"msgType":"report"}));
}

function killed () {
    if (gameData.canBeKilled && gameData.role != "impostor") {
        sound.play('kill');
        gameData.dead = true;
        let screen = document.getElementById("killscreen");
        screen.style.display = "flex";
        screen.animate(fadeIn, {duration:500});
        webSocket.send(JSON.stringify({"msgType":"killed"}));
    }
}

function revealRole () {
    return new Promise(function(resolve, reject) {
        let text = document.getElementById("revealrole");
        let screen = document.getElementById("revealrolescreen");
        text.innerText = "Shush it!";
        text.style.color = "white";
        text.style.opacity = "0";
        screen.style.display = "flex";
        screen.animate(fadeIn, fadeInTiming).finished.then(()=>{
            document.getElementById("lobby").style.display = "none";
            text.animate(fadeInOut, fadeInTiming).finished.then(()=>{
                if (gameData.role == "impostor") {
                    text.innerText = "Impostor";
                    text.style.color = "red";
                } else {
                    text.innerText = "Crewmate";
                    text.style.color = "blue";
                }
                sound.play("start");
                text.animate(fadeInOut, {duration:5000}).finished.then(()=>{
                    resolve();
                    screen.animate(fadeOut, {duration:500}).finished.then(()=>{
                        screen.style.display = "none";
                    });
                });
            });
        });
    });
}

function eject (theName, wasImposter) {
    return new Promise(function(resolve, reject) {
        let name = document.getElementById("kickname");
        let revealRole = document.getElementById("wasImposter");
        let screen = document.getElementById("kickscreen");
        name.style.opacity = "0";
        if (theName != "nobody") {
            if (wasImposter) {
                revealRole.innerText = "was the Impostor.";
            } else {
                revealRole.innerText = "was not the Impostor.";
            }
            name.innerText = theName;
        } else {
            name.innerText = "No one";
            revealRole.innerText = "was ejected";
        }

        revealRole.style.opacity = "0";
        screen.style.display = "flex";
        screen.animate(fadeIn, fadeInTiming).finished.then(()=>{
            name.animate(fadeIn, fadeInTiming).finished.then(()=>{
                name.style.opacity = "1";
                revealRole.animate(fadeIn, fadeInTiming).finished.then(()=>{
                    revealRole.style.opacity = "1";
                    setTimeout(()=>{
                        resolve();
                        screen.animate(fadeOut, {duration:500}).finished.then(()=>{
                            screen.style.display = "none";
                        });
                    }, 3000);
                });
            });
        });
    });
}

function killTimer (time) {
    let timeLeft = time;
    let ticker = setInterval(() => {
        if (timeLeft < 0) {
            document.getElementById("impostorticker").innerText = "killed?";
            clearInterval(ticker);
        } else {
            document.getElementById("impostorticker").innerText = timeLeft;
            timeLeft = timeLeft - 1;
        }
    }, 1000);
}

function initializeGameScreen () {
    updateTaskList();
    updateTaskBar();
}

function updateTaskList () {
    let list = document.getElementById("tasklist");
    let child = list.lastElementChild;
    while (child) { // remove all tasks
        list.removeChild(child);
        child = list.lastElementChild;
    }
    gameData.tasks.forEach((task)=>{
        let listElement = document.createElement("li");
        listElement.innerText = `${task.place}: ${task.name}`;
        if (task.done) {
            listElement.classList.add("done");
        }
        list.appendChild(listElement);
    });
}

function updateTaskBar () {
    let taskbar = document.getElementById("actualbar");
    taskbar.style.width = gameData.taskBarProgress + "%";
}

function syncGame(data) { // for when we aren't starting clean
    gameData = Object.assign({}, defaultGameData);

    // update flags
    gameData.taskBarProgress = data.taskProgress;
    gameData.emgmtgs = data.emgmtgs;
    gameData.tasks = data.tasks;
    gameData.meetingData = data.meetingData;
    // set role
    if (data.impostor) {
        gameData.role = "impostor";
    } else {
        gameData.role = "crewmate";
    }

    // render all the things
    if (data.gameState == "lobby") {
        // show lobby
        gameData.canScan = false;
    } else {
        // show game screen
        if (data.meetingInProgress) {
            // show meeting screen
            // or dont
            updateMeetingPlayerList();
            let skipbutton = document.getElementById("skipbutton");
            if (data.votedFor !== "") {
                gameData.voted = true;
                gameData.selectedPlayerBox = false;
                skipbutton.style.display = "none";
            } else {
                gameData.voted = false;
                gameData.selectedPlayerBox = false;
                skipbutton.style.display = "grid";
            }
            document.getElementById("votescreen").style.display = "grid";
        } else {
            gameData.canScan = true;
        }
        if (qrscanner == null) {
            startCamera();
        }
        initializeGameScreen();
        gameData.canScan = true;
    }
}

function handleMessage(message) {
    console.log(message);
    switch (message.msgType) {
        case "updatePlayer":
            console.log("Update Player");
            username = message.username;
            uid = message.uid;
            if (useLocalStorage) {
                localStorage.setItem('uid', uid);
            }
            break;
        case "joinAccepted":
            if (message.gameState == "lobby") {
                document.getElementById("lobby").style.display = "grid";
            }
            if (syncRequired) {
                webSocket.send(JSON.stringify( {"msgType":"syncRequest"} ));
            }
            break;
        case "sync":
            console.log("Performing game reset.");
            syncGame(message.data);
            break;
        case "startGame":
            console.log("Start game");
            startGame(message);
            break;
        case "gameEnded":
            console.log("Game Ended");
            endGame(message.winner);
            break;
        case "updateTaskBar":
            gameData.taskBarProgress = message.value;
            updateTaskBar();
            break;
        case "joinDenied":
            joinDenied();
            break;
        case "NOKILLINGBOIS":
            gameData.canBeKilled = false;
            if (gameData.role == "impostor") {
                killTimer(message.cooldown);
            }
            break;
        case "goodToKillNow":
            gameData.canBeKilled = true;
            break;
        case "meeting":
            if (!gameData.dead) {
                meeting(message);
            }
            break;
        case "meetingEnd":
            meetingEnded(message.kicked, message.wasImpostor);
            break;
        case "playerVoted":
            // do something
            // message.player
            break;
        case "probeResponse":
            handleProbeResponse(message);
            break;
    }
}

function joinGame() {
    if ((username != undefined) || (uid !== null)) {
        let message = {};
        message.msgType = "join";
        message.code = gameCode;
        message.username = (username || "idk what my username is");
        message.uid = (uid || "idk what my uid is");
        webSocket.send(JSON.stringify(message));
        document.getElementById("usernamemenu").style.display = "none";
        document.getElementById("permissionsmenu").style.display = "none";
    } else {
        // not enough info to join.
        console.log("not enough info to join.");
    }

}

function joinDenied () {
    console.log("Join has been denied");
    document.getElementById("gamestarted").style.display = "grid";
}

// Setup Functions
function permsAllowed() {
    document.getElementById("lobby").style.display = "grid";
    document.getElementById("permissionsmenu").style.display = "none";
    document.getElementById("setup").style.display = "none";
    gameReady = true;
    joinGame();
}
// function allowCamera() {
//     var constraints = {
//         audio: false,
//         video: {
//          facingMode: "environment"
//         }
//     };
//     try {
//         navigator.mediaDevices.getUserMedia(constraints).then((stream)=>{
//             let tracks = stream.getTracks();
//             tracks[0].stop();
//             // camera is enabled
//             permsAllowed();
//         });
//     } catch (e) {
//         console.log(e);
//         // camera is disabled
//     }
// }
function allowCamera() {
    Html5Qrcode.getCameras().then(devices => {
        /**
         * devices would be an array of objects of type:
         * { id: "id", label: "label" }
         */
        if (devices && devices.length) {
          camera = devices[0].id;
          // .. use this to start scanning.
          permsAllowed();
        }
      }).catch(err => {
        // handle err
      });
}
function submitUsername() {
    // check and save username
    let usernameGood = true;
    let reason = "Bad username";
    let inputUsername = document.getElementById("username").value.trim();
    document.getElementById("username").value = inputUsername;

    if (inputUsername.length > 13) {
        usernameGood = false;
        reason = `Username is ${inputUsername.length - 13} letters too long`;
    }
    if (inputUsername.length < 3) {
        usernameGood = false;
        reason = "Username too short";
    }
    if (inputUsername == "") {
        reason = "You can't play without a username";
    }

    if (usernameGood) {
        username = inputUsername;
        document.getElementById("usernamemenu").style.display = "none";
        document.getElementById("permissionsmenu").style.display = "grid";
    } else {
        alert(reason);
    }
}
function checkIfBrowserSupported() {
    let supported = false;
    if ("mediaDevices" in navigator) {
        supported = true;
    }
    return supported;
}

function probeGame() {
    let probe = {
        "msgType":"probe",
        "code":gameCode,
    };
    if (uid !== null) { // If we know our uid then put it here
        probe.uid = uid;
    }
    webSocket.send(JSON.stringify(probe));
}

function handleProbeResponse(message) {
    if (message.gameState != "lobby") {
        if (message.uidMatch || false) {
            syncRequired = true;
            joinGame();
        } else {
            joinDenied();
        }
    }
}

// Websocket stuff
function connectToServer() {
    let home = "wss://" + location.host;
    console.log(home);
    webSocket = new WebSocket(home);
    webSocket.onopen = function(){
        console.log('connected!');
        if (gameReady || false) {
            joinGame();
        }
        if (firstConnection) {
            firstConnection = false;
            probeGame();
        }
        wsReconnects = 0;
    };
    webSocket.onmessage = function(e){
        handleMessage(JSON.parse(e.data));
    };
    webSocket.onclose = function(){
        console.log('ws closed!');
        if (wsReconnects < 1) {
            wsReconnects = wsReconnects + 1;
            wsCheck();
        }
    };
}
function wsCheck() {
    if (navigator.onLine == true) {
        if(!webSocket || webSocket.readyState == 3) {
            wsReconnects = wsReconnects + 1;
            connectToServer();
        }
    }
}
connectToServer();
setInterval(wsCheck, 5000);

// animations

var fadeInTiming = {
    duration: 2000,
    easing: 'ease-in-out',
}
var fadeIn = [
    { opacity:0 },
    { opacity:1 }
];
var fadeOut = [
    { opacity:1 },
    { opacity:0 }
];
var fadeInOut = [
    { opacity:0 },
    { opacity:1 },
    { opacity:1 },
    { opacity:1 },
    { opacity:1 },
    { opacity:0 },
];
