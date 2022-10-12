const { Client, Intents } = require('discord.js');
const prefix = '!';
var pingCount = 0;
var MILLI = 1000;
var ZERO = 48; // char code of '0'.
var CHAR_CODE_A = 97; // char code of 'a'.
var frillPiece = ":blue_heart: :purple_heart: :orange_heart: ";
var frill = frillPiece+frillPiece;
var skullPiece = ":skull: ";
var skulls = skullPiece+skullPiece+skullPiece;
var thought = ":thought_balloon: ";

const client = new Client({
    intents: [
        Intents.FLAGS.DIRECT_MESSAGE_REACTIONS,
        Intents.FLAGS.DIRECT_MESSAGES,
        Intents.FLAGS.DIRECT_MESSAGE_TYPING,
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES
    ],
    
    partials: [
        'CHANNEL', // Required to receive DMs
    ]
});

var fs = require("fs");

var wordListFile = fs.readFileSync("./wordlist_1.txt", 'utf-8');
var wordList = wordListFile.split("\r\n");

var wordListEasyFile = fs.readFileSync("./wordlist_0.txt", 'utf-8');
var wordListEasy = wordListEasyFile.split("\r\n");

var intervalFunc = null;

var game = newClearGame("", new Array(0));

client.once('ready',() => {
    console.log(`WordleEdit bot is online as ${client.user.tag}!`);
    client.user.setActivity('!create, !join', { type: 'WATCHING' });
});

client.on("messageCreate", (message) => {
    if (message.author.bot) {
        return;
    } else if (message.channel.type == "DM") {
        var player_index = getPlayerIndex(message.author);
        if (player_index < 0) {
            message.author.send("Sorry, you aren't in a current WordleEdit game. Join the game using \"`!join`\" or \"`!create`\" a new game.");
        } else {
            if (game["stage"] == 2) {
                var wc = game["word_count"];
                if (game["words"][player_index].length == wc) {
                    message.author.send("You have already written enough words for this game ("+wc+").");
                } else {
                    processWritingSubmission(game, player_index, message.content);
                    if (hasEveryoneFinishedWriting(game)) {
                        startGuessingStage(game);
                    }
                }
            } else if (game["stage"] == 3) {
                if (message.content.length >= 10 && message.content.includes(' ')) {  // The player initiated an "Edit"!
                    processEditingSubmission(game, player_index, message.content);
                } else {
                    var gc = game["guesses"][player_index].length;
                    if (gc == game["round_count"]) {
                        message.author.send("You've already submitted a guess for this turn! Wait for the turn to finish.");
                    } else {
                        processGuessingSubmission(game, player_index, message.content);
                        if (hasEveryoneFinishedGuessing(game)) {
                            finishGuessingTurn(game);
                        }
                    }
                }
            }
        }
        return;
    } else if (!message.content.startsWith(prefix)) {
        return;
    }
    
    const args = message.content.slice(prefix.length).split(" ");
    const command = args.shift().toLowerCase();
    if (command === 'ping') {
        pingCount++;
        message.channel.send("PONG!!! "+pingCount+' pings have been said since I last started up.');
    } else if (command === 'getreply') {
        message.author.send("Here is your reply");
    } else if (game["stage"] >= 1) {
        if (message.channel == game["channel"]) {
            handleGameMessage(message);
        } else {
            message.channel.send("There's a WordleEdit game going on in a different channel right now. Please wait for that to finish first.");
        }
    } else if (command == 'create') {
        game = newClearGame(message.channel, args);
        game["stage"] = 1
        message.channel.send(announceStringOf(game,1));
    }
});

function processWritingSubmission(game, player_index, receivedMessage) {
    var response = parseSubmittedWord(game, player_index, receivedMessage, game["allow_hard_words"]);
    var word = response[0];
    var alert_ = response[1];
    if (word.length == 5) { // The player submitted a successful word.
        game["words"][player_index].push(word);
    }
    game["player_list"][player_index].send(alert_);
}

function processGuessingSubmission(game, player_index, receivedMessage) {
    var response = parseSubmittedWord(game, player_index, receivedMessage, true);
    var word = response[0];
    var _alert = response[1];
    
    if (word.length == 5) { // The player submitted a successful word.
        game["guesses"][player_index].push(word);
        if (!hasEveryoneFinishedGuessing(game)) {
            game["player_list"][player_index].send(_alert).then(message => {
                game["waiting_messages_to_delete"].push(message);
            });
        }
    } else {
        game["player_list"][player_index].send(_alert);
    }
}

function processEditingSubmission(game, player_index, receivedMessage) {
    var parts = receivedMessage.split(" ");
    var nextI = (player_index+1)%game["player_list"].length;
    var wordOn = game["word_on"][nextI];
    var origWord = game["words"][player_index][wordOn];
    if (parts[0].toLowerCase() != origWord) {
        game["player_list"][player_index].send("If you're trying to initiate an edit, the first word must be the word your opponent is trying to guess. Right now, that's "+formatWord(origWord,true,false)+".");
        return;
    }
    
    var response = parseSubmittedWord(game, player_index, parts[1], game["allow_hard_words"]);
    var newWord = response[0];
    var _alert = response[1];
	if(newWord == origWord){
		game["player_list"][player_index].send("Edit at least one letter of the word.");
		return;
	}
    if (newWord.length == 5) { // The player submitted a successful word to edit into.
        var editCost = getEditCost(origWord,newWord);
        
        if (editCost > game["edits"][player_index]) { // you don't have enough money for that.
            game["player_list"][player_index].send("TOO POOR. You only have "+pluralize(game["edits"][player_index],"edit")+" in the bank, but editing your "+rankify(wordOn)+" word from "+formatWord(origWord, true, false)+" to "+formatWord(newWord, true, false)+" would cost you "+pluralize(editCost,"edit")+".");
        } else {
            game["words"][player_index][wordOn] = newWord;
            game["most_recent_edit"][player_index] = game["round_count"];
            game["edits"][player_index] -= editCost;
            
            var appendix = "";
            if (game["guesses"][player_index].length < game["round_count"]) {
                appendix = "\nDon't forget to write a guess for YOUR word, though!";
            }
            game["player_list"][player_index].send("SUCCESS! Your "+rankify(wordOn)+" word was successfully edited from "+formatWord(origWord, true, false)+" to "+formatWord(newWord, true, false)+"! That cost you "+pluralize(editCost,"edit")+", leaving you with "+pluralize(game["edits"][player_index],"edit")+" left."+appendix);
        }
    } else {
        game["player_list"][player_index].send(_alert);
    }
}

function getEditCost(a, b) {
    var count = 0;
    for (var i = 0; i < 5; i++) {
        if (a.charAt(i) != b.charAt(i)) {
            count += 1;
        }
    }
    return count;
}

function pluralize(n, stri) {
    if (n == 1) {
        return n+" "+stri;
    } else {
        return n+" "+stri+"s";
    }
}

function hasEveryoneFinishedWriting(game) {
    var LEN = game["player_list"].length;
    for (var i = 0; i < LEN; i++) {
        if (game["words"][i].length < game["word_count"]) {
            return false;
        }
    }
    return true;
}
function hasEveryoneFinishedGuessing(game) {
    var LEN = game["player_list"].length;
    for (var i = 0; i < LEN; i++) {
        if (game["guesses"][i].length < game["round_count"]) {
            return false;
        }
    }
    return true;
}


function getPlayerIndex(author) {
    var LEN = game["player_list"].length;
    for (var i = 0; i < LEN; i++) {
        if (author == game["player_list"][i]) {
            return i;
        }
    }
    return -1;
}

function parseSubmittedWord(game, player_index, message, allow_hard_words) {
    var word = message.toLowerCase().replace(/[^a-z]/gi,'');
    if (word.length < 5) {
        return ["","That word is not long enough."];
    } else {
        word = word.substring(0,5);
        var thisWordList = allow_hard_words ? wordList : wordListEasy;
        if (thisWordList.includes(word)) {
            var alert_ = "";
            if (game["stage"] == 2) {
                var wordCountSoFar = game["words"][player_index].length;
                alert_ = "Word # "+(wordCountSoFar+1)+" of "+game["word_count"]+" successfully received as "+formatWord(word,true, false);
                if (wordCountSoFar == game["word_count"]-1) {
                    alert_ += ". You have finished submitting all words for this game.";
                }
            } else if (game["stage"] == 3) {
                var guessCount = game["guesses"][player_index].length;
                alert_ = "Guess # "+(guessCount+1)+" successfully received as "+formatWord(word, true, false)+". Waiting for the round to finish.";
            }
            return [word,alert_];
        } else {
            return ["","That word isn't in Wordle's dictionary, try again."];
        }
    }
}

function getCode(guess, answer) {
    var LEN = 5;

    var guessArr = new Array(LEN);
    var answerArr = new Array(LEN);
    var result = new Array(LEN);
    for (var pos = 0; pos < LEN; pos++) {
        guessArr[pos] = guess.charCodeAt(pos)-CHAR_CODE_A;
        answerArr[pos] = answer.charCodeAt(pos)-CHAR_CODE_A;
        result[pos] = 0;
    }
    
    for (var pos = 0; pos < LEN; pos++) {
        var g = guessArr[pos];
        if (answerArr[pos] == g) {
            result[pos] = 2;
            guessArr[pos] = -1; // ensure that letter can't be used again. (Like if the word is 'CLERK' and you guess 'STEEP', the first E uses up the E, so the second E can't claim it.)
            answerArr[pos] = -1;
        }
    }
    var resultString = "";
    for (var pos = 0; pos < LEN; pos++) {
        if (result[pos] == 0) {
            for (var apos = 0; apos < LEN; apos++) {
                if (answerArr[apos] == guessArr[pos]) {
                    result[pos] = 1;
                    guessArr[pos] = -1; // ensure that letter can't be used again.
                    answerArr[apos] = -1;
                }
            }
        }
        resultString += String.fromCharCode(result[pos] + CHAR_CODE_A);
    }
    return resultString;
}


function handleGameMessage(message) {
    var mc = message.channel;
    const args = message.content.slice(prefix.length).split(" ");
    const command = args.shift().toLowerCase();
    var author = message.author;
    if (command == 'join') {
        if (game["stage"] == 1) {
            if (game["player_list"].includes(author)) {
                mc.send(author.username+", you're already in this game. Don't try to join twice.");
            } else {
                game["player_list"].push(author);
                
                var words = new Array(0);
                game["words"].push(words);
                var guesses = new Array(0);
                game["guesses"].push(guesses);
                var codes = new Array(0);
                game["codes"].push(codes);
                
                game["word_on"].push(0);
                game["edits"].push(0);
                game["max_greens"].push(0);
                game["most_recent_edit"].push(-1);
                game["most_recent_new_word"].push(-1);
                mc.send(author.username+" just joined the game. "+
                    "\nPlayer count: "+game["player_list"].length);
            }
        } else {
            mc.send("It's the wrong stage of game for that.");
        }
    } else if (command == 'start') {
        if (game["stage"] == 1) {
            var PLAYER_COUNT = game["player_list"].length;
            if (PLAYER_COUNT < 1) {
                message.channel.send("There are only "+PLAYER_COUNT+" players. Not enough.");
            } else {
                startGame(game, args);
            }
        } else {
            mc.send("It's the wrong stage of game for that.");
        }
    } else if (command == 'create') {
        mc.send("It's the wrong stage of game for that.");
    } else if (command == 'abort') {
        abort(game, "This WordleEdit game has been aborted.");
        game["stage"] = 0;
    }
}

function abort(game, message) {
    if (intervalFunc != null) {
        deleteMessages(game, "timer_messages_to_edit");
        clearInterval(intervalFunc);
    }
    alertChannelAndPlayers(game, message);
}

function alertChannelAndPlayers(game, stri) {
    game["channel"].send(stri);
    var LEN = game["player_list"].length;
    for (var i = 0; i < LEN; i++) {
        game["player_list"][i].send(stri);
    }    
}

function startGame(game, args) {
    var mc = game["channel"];
    game["stage"] = 2;
    mc.send(frill+" **STARTING THE WORDLEEDIT GAME NOW!** "+frill);
    mc.send(announceStringOf(game,2)+"\nPlayers, go into your DMs with this bot to play the remainder of this game.");
    
    game["timer"] = game["writing_stage_time"];
    game["timer_messages_to_edit"] = new Array(0);
    
    setTimersAndMessagePlayerList(game);
    
    intervalFunc = setInterval(function() {
        updateAllTimers(game);
        if (game["timer"] <= 0) {
            wrapUpWritingStageBecauseTimeRanOut(game);
            startGuessingStage(game);
        }
    }, 2000);
}

function wrapUpWritingStageBecauseTimeRanOut(game) {
    var LEN = game["player_list"].length;
    var wc = game["word_count"];
    for (var p_i = 0; p_i < LEN; p_i++) {
        var swc = game["words"][p_i].length;
        var pc = game["player_list"][p_i]; // player channel
        if (swc == wc) {
            pc.send("Congrats! You submitted all your words on time.");
        } else {
            var rwc = wc-swc;
            var messageString = "You only submitted "+pluralize(swc,"word")+" on time. So, the final "+pluralize(rwc,"word")+" have been randomly chosen by the bot (me) to be:"
            for (var w_i = 0; w_i < rwc; w_i++) {
                var word = getRandomWord(game);
                messageString += "\n"+formatWord(word, true, false);
                game["words"][p_i].push(word);
            }
            pc.send(messageString);
        }
    }
}

function deleteMessages(game, list) {
    var LEN = game[list].length;
    for (var i = 0; i < LEN; i++) {
        var m = game[list][i];
        if (m != null) {
            m.delete();
        }
    }
    game[list] = new Array(0);
}

function startGuessingStage(game) {
    deleteMessages(game, "timer_messages_to_edit");
    clearInterval(intervalFunc);
    
    game["stage"] = 3;
    game["round_count"] = 1;
    alertChannelAndPlayers(game, "All players have submitted their words. Time for the guessing stage to begin.");
    
    startGuessingTurn(game);
}

function startGuessingTurn(game) {
    game["timer"] = game["guessing_stage_time"];
    game["timer_messages_to_edit"] = new Array(0);
    
    setTimersAndMessagePlayerList(game);
    
    intervalFunc = setInterval(function() {
        updateAllTimers(game);
        if (game["timer"] <= 0) {
            finishGuessingTurn(game);
        }
    }, 2000);
}

function getRandomWord(game) {
    var thisGamesWordList = game["allow_hard_words"] ? wordList : wordListEasy;
    var choice = Math.floor(Math.random()*thisGamesWordList.length);
    return thisGamesWordList[choice];
}

function countGreens(code) {
    var count = 0;
    for (var i = 0; i < code.length; i++) {
        if (code.charCodeAt(i) == 2+CHAR_CODE_A) {
            count += 1;
        }
    }
    return count;
}

function calculatePlayersRoundPerformance(game, p_i, r, LEN) {
    var pgc = game["guesses"][p_i].length;
    var pc = game["player_list"][p_i]; // player channel
    if (pgc < game["round_count"]) {
        if (game["auto_guess"]) {
            var word = getRandomWord(game);
            game["guesses"][p_i].push(word);
            pc.send("You didn't guess in time. So, your guess will be randomly chosen by the bot (me) to be:\n"+formatWord(word,true, false));
        } else {
            var word = "*****";
            game["guesses"][p_i].push(word);
            pc.send("You didn't guess in time, so we're going to skip your turn! Better luck next time.");
        }
    }
    var prevI = (p_i+LEN-1)%LEN;
    var wordOn = game["word_on"][p_i];
    var guess = game["guesses"][p_i][r];
    var answer = game["words"][prevI][wordOn];
    var code = getCode(guess, answer);
    game["codes"][p_i].push(code);
    
    var greenCount = countGreens(code);
    var diff = greenCount-game["max_greens"][p_i];
    if (diff > 0) {
        if (diff >= game["greens_needed_for_an_edit"]) {
            game["edits"][p_i] = Math.min(game["edits"][p_i]+1,game["max_edits"]);
            // you get one edit if you uncover 2+ green tiles.
        }
        game["max_greens"][p_i] = greenCount;
    }
    
    if (countLetters(code, 'a') >= game["grays_needed_for_an_edit"]) {
        var prevI = (p_i+LEN-1)%LEN;
        game["edits"][prevI] = Math.min(game["edits"][prevI]+1,game["max_edits"]); // you get one edit if your opponent gets 5 grays on your word.
    }
}

function countLetters(stri, ch) {
    var count = 0;
    for (var i = 0; i < stri.length; i++) {
        if (stri.charAt(i) == ch) {
            count += 1;
        }
    }
    return count;
}


function finishGuessingTurn(game) {
    var r = game["round_count"]-1; // the index of the round we're on.
    var LEN = game["player_list"].length;
    for (var p_i = 0; p_i < LEN; p_i++) {
        calculatePlayersRoundPerformance(game, p_i, r, LEN);
    }
    deleteMessages(game, "timer_messages_to_edit");
    deleteMessages(game, "waiting_messages_to_delete");

    game["channel"].send(formatRoundResult(game, r, -1));
    for (var p_i = 0; p_i < LEN; p_i++) {
        game["player_list"][p_i].send(formatRoundResult(game, r, p_i));
    }
    
    var finishers = new Array(0);
    for (var p_i = 0; p_i < LEN; p_i++) {
        if (game["codes"][p_i][r] === "ccccc") {
            var prevI = (p_i+LEN-1)%LEN;
            var prevP = game["player_list"][prevI];
            var wordOn = game["word_on"][p_i];
            if (wordOn >= game["word_count"]-1) {
                finishers.push(p_i);
            }
            if (game["word_on"][p_i] < game["word_count"]-1) {
                game["player_list"][p_i].send("Congrats, you solved "+prevP.username+"'s "+rankify(wordOn)+" word! Guess their "+    rankify(wordOn+1)+" one.");
            }
            
            game["word_on"][p_i] += 1;
            game["max_greens"][p_i] = 0;
            game["most_recent_new_word"][p_i] = r+1;
        }
    }
    
    if (finishers.length >= 1) { // someone finished the game.
        if (finishers.length == 1) {
            var f = finishers[0];
            var winner = game["player_list"][f];
            var prevI = (f+LEN-1)%LEN;
            var prevP = game["player_list"][prevI];
            
            winner.send(frill+"YOU WON! Congrats, you solved "+prevP.username+"'s final word, so you've won. "+frill);
            for (var p_i = 0; p_i < LEN; p_i++) {
                if (p_i != f) {
                    game["player_list"][p_i].send(skulls+"YOU LOST. "+winner.username+" just solved "+prevP.username+"'s final word, so they won. "+skulls);
                }
            }    
            game["channel"].send(frill+winner.username+" WON! They solved "+prevP.username+"'s final word. "+frill);
        } else {
            for (var f_i = 0; f_i < finishers.length; f_i++) {
                var f = finishers[f_i];
                var winner = game["player_list"][f];
                var prevI = (f+LEN-1)%LEN;
                var prevP = game["player_list"][prevI];
                winner.send(frill+" YOU TIED! Congrats, you solved "+prevP.username+"'s final word, so you've completed the game! You finished on the same turn as "+getTiedString(game, finishers, f_i)+"."+frill);
            }
            
            game["channel"].send(frill+getTiedString(game, finishers, -1)+" TIED! They solved their final words on the same turn. "+frill);
        }
        abort(game, "This WordleEdit game has ended.");
        game["stage"] = 0;
    } else {
        game["round_count"]++;
        clearInterval(intervalFunc);
        startGuessingTurn(game);
    }
}

function getTiedString(game, finishers, exclude) {
    var tiedString = "";
    for (var f_j = 0; f_j < finishers.length; f_j++) {
        if (f_j != exclude) {
            tiedString += game["player_list"][finishers[f_j]].username+" and ";
        }
    }
    return tiedString.substring(0,tiedString.length-5); // remove the final " and ".
}

function formatRoundResult(game, round_i, player_i) {
    var black = ":black_large_square: ";
    var boom = ":boom: ";
    var pencil = ":pencil: ";
    var puzzle = ":jigsaw: ";
    var questWord = "";
    for (var i = 0; i < 5; i++) {
        questWord += ":question: ";
    }
    
    var LEN = game["player_list"].length;
    
    var guesses_string = ". ";
    var codes_string = ". ";
    var truth_string = ". ";
    for (var pseudo_i = 0; pseudo_i < LEN; pseudo_i++) {
        var p_i = pseudo_i;
        if (player_i >= 0) {
            p_i = (pseudo_i+player_i)%LEN;
        }
        var prevI = (p_i+LEN-1)%LEN;
        var tile = black;
        if (game["most_recent_edit"][prevI] == game["round_count"]) { // this person's word was edited. Ooooh.
            tile = boom;
        }
        var wordOn = game["word_on"][p_i];
        
        guesses_string += tile+puzzle+formatWord(game["guesses"][p_i][round_i], true, true)+pencil+tile;
        var w = (game["word_on"][p_i]+1)%10;
        var e = game["edits"][p_i]%10;
        codes_string += tile+formatNumber(w)+formatCode(game["codes"][p_i][round_i], true, true)+formatNumber(e)+tile;
        
        var truth_piece = questWord;
        if (player_i == prevI || game["codes"][p_i][round_i] === "ccccc") { // you know the answer word, since you chose it. OR it's solved!
            truth_piece = formatWord(game["words"][prevI][wordOn], true, true);
        }
        truth_string += tile+tile+truth_piece+tile+tile;
    }
    
    
    if (player_i >= 0 && game["show_keyboard"]) { // this is a human player, not the spectator
        var remainingCharacters = getRemainingCharacters(game, player_i);
        
        var rows = new Array(3);
        for (var r = 0; r < 3; r++) {
            rows[r] = black+black+black+thought;
        }
        var perRow = Math.ceil(remainingCharacters.length/3);
        
        for (var ch_i = 0; ch_i < remainingCharacters.length; ch_i++) {
            var ch = remainingCharacters[ch_i];
            var character_block = formatLetter(ch);
            var row = Math.floor(ch_i/perRow);
            rows[row] += character_block;
        }
        guesses_string += rows[0];
        codes_string += rows[1];
        truth_string += rows[2];
    }
    
    var result = "";
    if (player_i >= 0) { // This is a player DM, so we have to put the username list each time.
        result += playerListToString(game, player_i)+"\n";
    } else if (round_i == 0) { // It's round 1 and publicly being shown, so we have to put the username list each time.
        result += playerListToString(game, 0)+"\n";
    }
    result += guesses_string+"\n"+codes_string;
    if (player_i >= 0) {
        result += "\n"+truth_string;
    }
    return result;    
}

function getRemainingCharacters(game, player_i) {
    var LEN = game["player_list"].length;
    var remainingCharacterIndices = new Array(26);
    for (var i = 0; i < 26; i++) {
        remainingCharacterIndices[i] = true;
    }
    var prevI = (player_i+LEN-1)%LEN;
    
    var firstUsefulRound = Math.max(game["most_recent_edit"][prevI],game["most_recent_new_word"][player_i],0);
    
    for (var round = firstUsefulRound; round < game["round_count"]; round++) {
        var guess = game["guesses"][player_i][round];
        var code = game["codes"][player_i][round];
        for (var i = 0; i < 5; i++) {
            if (code.charAt(i) == 'a') {
                var DQedLetter = guess.charCodeAt(i)-CHAR_CODE_A;
                remainingCharacterIndices[DQedLetter] = false;
            }
        }
        for (var i = 0; i < 5; i++) { // in case the word is something like 'CHEER', and one 'E' is gray and the other is yellow, the first for-loop will see the gray E and kick E off the keyboard, but it shouldn't be removed since the yellow E proves it's there.
            if (code.charAt(i) != 'a') {
                var approvedLetter = guess.charCodeAt(i)-CHAR_CODE_A;
                remainingCharacterIndices[approvedLetter] = true;
            }
        }
    }
    
    var remainingCharacters = new Array(0);
    for (var i = 0; i < 26; i++) {
        if (remainingCharacterIndices[i]) {
            remainingCharacters.push(String.fromCharCode(i + CHAR_CODE_A));
        }
    }
    return remainingCharacters;
}

function updateAllTimers(game) {
    game["timer"] -= 2;
    if (game["timer"] >= 2) {
        var editedStri = formatTime(game["timer"]);
        var LEN = game["timer_messages_to_edit"].length;
        for (var i = 0; i < LEN; i++) {
            var mess = game["timer_messages_to_edit"][i];
            if (mess != null) {
                mess.edit(editedStri);
            }
        }
    }
}

function setTimersAndMessagePlayerList(game) {
    game["channel"].send(formatTime(game["timer"])).then(message => {
        game["timer_messages_to_edit"].push(message);
    });
    
    var LEN = game["player_list"].length;
    for (var i = 0; i < LEN; i++) {
        var prevI = (i+LEN-1)%LEN;
        var nextI = (i+1)%LEN;
        var p = game["player_list"][i];
        var nextP = game["player_list"][nextI];
        var prevP = game["player_list"][prevI];
        
        if (game["stage"] == 2) {
            game["player_list"][i].send("Hello, "+p.username+"! In this WordleEdit game, you are Player #"+(i+1)+" of "+LEN+". Please type "+pluralize(game["word_count"], "word")+" for Player #"+(nextI+1)+" ("+nextP.username+") to guess.");
        } else if (game["stage"] == 3 && game["round_count"] == 1) {
            var wordOn = game["word_on"][i];
            game["player_list"][i].send("Please guess "+prevP.username+"'s "+rankify(wordOn)+" word.");
        }
        
        game["player_list"][i].send(formatTime(game["timer"])).then(message => {
            game["timer_messages_to_edit"].push(message);
        });
    }
}
function rankify(n) {
    var modN = (n%100)+1;
    var suffix = "";
    if (modN >= 10 && modN < 20) {
        suffix = "th";
    } else {
        if (modN%10 == 1) {
            suffix = "st";
        } else if (modN%10 == 2) {
            suffix = "nd";
        } else if (modN%10 == 3) {
            suffix = "rd";
        } else {
            suffix = "th";
        }
    }
    return (n+1)+suffix;
}

function playerListToString(game, indexShift) {
    var RESULT_STR = "";
    var LEN = game["player_list"].length;
    for (var i = 0; i < LEN; i++) {
        if (i == 1 && LEN == 2) {
            RESULT_STR += "   <--->   ";
        } else {
            if (i >= 1) {
                RESULT_STR += "   ---->   ";
            }
        }
        if (i == game["position"]) {
            RESULT_STR += ":arrow_right:";
        }
        RESULT_STR += game["player_list"][(i-indexShift+LEN)%LEN].username;
    }
    return RESULT_STR;
}

function formatWord(word, emojify, finalSpace) {
    if (emojify) {
        var result = "";
        for (var i = 0; i < 5; i++) {
            var toAdd = (word.charAt(i) == '*') ? ":question:" : ":regional_indicator_"+word.charAt(i)+":";
            result += toAdd;
            if (finalSpace || i < 4) {
                result += " ";
            }
        }
        return result;
    } else {
        return word.toUpperCase();
    }
}

function formatLetter(ch) {
    return ":regional_indicator_"+ch+": ";
}

function formatCode(code, emojify, finalSpace) {
    if (emojify) {
        var emojis = [":white_large_square:",":yellow_square:",":green_square:",":green_heart:"]
        var result = "";
        for (var i = 0; i < 5; i++) {
            if (code === "ccccc") {
                result += emojis[3];
            } else {
                result += emojis[code.charCodeAt(i)-CHAR_CODE_A];
            }
            if (finalSpace || i < 4) {
                result += " ";
            }
        }
        return result;
    } else {
        return code.toUpperCase();
    }
}

function formatTime(timer) {
    return "Time left: "+formatNumber(timer);
}

function formatNumber(number) {
    var sNumber = number+"";
    var numberNames = ["zero","one","two","three","four","five","six","seven","eight","nine"];
    var LEN = sNumber.length;
    var result = "";
    for (var i = 0; i < LEN; i++) {
        result += ":"+numberNames[sNumber.charCodeAt(i)-ZERO]+": ";
    }
    return result;
}

function announceStringOf(game,stage) {
    var ANNOUNCE_STR = "We're creating a brand new game of WordleEdit!";
    if (stage == 1) {
        ANNOUNCE_STR += "\nType \"`!join`\" to join this game."
    } else if (stage == 2) {
        ANNOUNCE_STR += "\n\nPlayer list: "
        for (var i = 0; i < game["player_list"].length; i++) {
            ANNOUNCE_STR += "\n"+game["player_list"][i].username;
        }
    }
    return ANNOUNCE_STR;
}

function newClearGame(mc, args) {
    var thisGame = [];
    thisGame["player_list"] = [];
    
    thisGame["words"] = new Array(0);
    thisGame["guesses"] = new Array(0);
    thisGame["codes"] = new Array(0);
    thisGame["word_on"] = new Array(0);
    thisGame["timer_messages_to_edit"] = new Array(0);
    thisGame["max_greens"] = new Array(0);
    thisGame["edits"] = new Array(0);
    thisGame["most_recent_edit"] = new Array(0);
    thisGame["most_recent_new_word"] = new Array(0);
    
    thisGame["word_count"] = defaultValue(args,0,3);
    thisGame["greens_needed_for_an_edit"] = defaultValue(args,1,2);
    thisGame["grays_needed_for_an_edit"] = defaultValue(args,2,5);
    thisGame["writing_stage_time"] = defaultValue(args,3,180);
    thisGame["guessing_stage_time"] = defaultValue(args,4,60);
    thisGame["allow_hard_words"] = yesNoValue(args,5,false);
    thisGame["auto_guess"] = yesNoValue(args,6,true);
    thisGame["show_keyboard"] = yesNoValue(args,7,true);
    
    thisGame["channel"] = mc;
    thisGame["stage"] = 0;
    thisGame["timer"] = 0;
    thisGame["round_count"] = 0;
    thisGame["waiting_messages_to_delete"] = new Array(0);
    
    thisGame["max_edits"] = 9;

    return thisGame;
}

function defaultValue(arr, index, def) {
    if (index >= arr.length) {
        return def;
    } else {
        return arr[index]*1;
    }
}

function yesNoValue(arr, index, def) {
    if (index >= arr.length) {
        return def;
    } else {
        return (arr[index] === "y");
    }
}

client.login(require("./token.json").token);
