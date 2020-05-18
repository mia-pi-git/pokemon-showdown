/*
 * Trivia plugin
 * Written by Morfent
 */

import {FS} from '../../lib/fs';

const MAIN_CATEGORIES: {[k: string]: string} = {
	ae: 'Arts and Entertainment',
	pokemon: 'Pok\u00E9mon',
	sg: 'Science and Geography',
	sh: 'Society and Humanities',
};

const SPECIAL_CATEGORIES: {[k: string]: string} = {
	misc: 'Miscellaneous',
	subcat: 'Sub-Category',
};

const ALL_CATEGORIES: {[k: string]: string} = {
	ae: 'Arts and Entertainment',
	misc: 'Miscellaneous',
	pokemon: 'Pok\u00E9mon',
	sg: 'Science and Geography',
	sh: 'Society and Humanities',
	subcat: 'Sub-Category',
};

const MODES: {[k: string]: string} = {
	first: 'First',
	number: 'Number',
	timer: 'Timer',
};

const TYPES: {[k: string]: string} = {
	trivia: 'Trivia',
};

const LENGTHS: AnyObject = {
	short: {
		cap: 20,
		prizes: [3, 2, 1],
	},
	medium: {
		cap: 35,
		prizes: [4, 2, 1],
	},
	long: {
		cap: 50,
		prizes: [5, 3, 1],
	},
};

Object.setPrototypeOf(MAIN_CATEGORIES, null);
Object.setPrototypeOf(SPECIAL_CATEGORIES, null);
Object.setPrototypeOf(ALL_CATEGORIES, null);
Object.setPrototypeOf(MODES, null);
Object.setPrototypeOf(LENGTHS, null);

const SIGNUP_PHASE = 'signups';
const QUESTION_PHASE = 'question';
const INTERMISSION_PHASE = 'intermission';
const LIMBO_PHASE = 'limbo';

const MINIMUM_PLAYERS = 3;
const START_TIMEOUT = 30 * 1000;
const INTERMISSION_INTERVAL = 20 * 1000;

const MAX_QUESTION_LENGTH = 252;
const MAX_ANSWER_LENGTH = 32;

const BANK_AMOUNTS = [1000, 2500, 5000, 10000, 25000, 50000, 75000, 125000];
const NUM_FINALS_QUESTIONS = 5;


type TriviaQuestion = {question: string, category: string, answers: string[], user?: string, type?: string};
type TriviaRank = [number, number, number];
type TriviaQuestions = TriviaQuestion[];
type TriviaLeaderboard = {[k: string]: TriviaRank};
type TriviaLadder = TriviaRank[][];
type TriviaData = {questions?: TriviaQuestions, submissions?: TriviaQuestions, leaderboard?: TriviaLeaderboard, altLeaderboard?: TriviaLeaderboard,ladder?: TriviaLadder, wlquestions?: TriviaQuestions, wlsubmissions?: TriviaQuestions}


const PATH = 'config/chat-plugins/triviadata.json';

/**
 * TODO: move trivia database code to a separate file once relevant.
 */
let triviaData: TriviaData = {};
try {
	triviaData = require(`../../${PATH}`);
} catch (e) {} // file doesn't exist or contains invalid JSON

if (!triviaData || typeof triviaData !== 'object') triviaData = {};
if (typeof triviaData.leaderboard !== 'object') triviaData.leaderboard = {};
if (typeof triviaData.altLeaderboard !== 'object') triviaData.altLeaderboard = {};
if (!Array.isArray(triviaData.questions)) triviaData.questions = [];
if (!Array.isArray(triviaData.submissions)) triviaData.submissions = [];
if (triviaData.questions.some(q => !('type' in q))) {
	triviaData.questions = triviaData.questions.map(q => Object.assign(Object.create(null), q, {type: 'trivia'}));
}
if (triviaData.wlquestions) delete triviaData.wlquestions;
if (triviaData.wlsubmissions) delete triviaData.wlsubmissions;

function writeTriviaData() {
	FS(PATH).writeUpdate(() => (
		JSON.stringify(triviaData, null, 2)
	));
}

/**
 * Binary search for the index at which to splice in new questions in a category,
 * or the index at which to slice up to for a category's questions
 * TODO: why isn't this a map? Storing questions/submissions sorted by
 * category is pretty stupid when maps exist for that purpose.
 */
function findEndOfCategory(category: string, inSubmissions?: boolean): number {
	let questions = inSubmissions ? triviaData.submissions : triviaData.questions;
	let left = 0;
	let right = questions!.length;
	let i = 0;
	let curCategory;
	while (left < right) {
		i = Math.floor((left + right) / 2);
		curCategory = questions![i].category;
		if (curCategory < category) {
			left = i + 1;
		} else if (curCategory > category) {
			right = i;
		} else {
			while (++i < questions!.length) {
				if (questions![i].category !== category) break;
			}
			return i;
		}
	}

	return left;
}

function sliceCategory(category: string): TriviaQuestion[] {
	let questions = triviaData.questions;
	if (!questions?.length) return [];

	let sliceUpTo = findEndOfCategory(category, false);
	if (!sliceUpTo) return [];

	let categories = Object.keys(ALL_CATEGORIES);
	let categoryIdx = categories.indexOf(category);
	if (!categoryIdx) return questions.slice(0, sliceUpTo);

	// findEndOfCategory for the category prior to the specified one in
	// alphabetical order returns the index of the first question in it
	let sliceFrom = findEndOfCategory(categories[categoryIdx - 1], false);
	if (sliceFrom === sliceUpTo) return [];

	return questions.slice(sliceFrom, sliceUpTo);
}

class Ladder {
	leaderboard: TriviaLeaderboard;
	cache: any;
	constructor(leaderboard: TriviaLeaderboard) {
		this.leaderboard = leaderboard;
		this.cache = null;
	}

	invalidateCache() {
		this.cache = null;
	}

	get() {
		if (this.cache) {
			return this.cache;
		}
		this.cache = this.computeCachedLadder();
		return this.cache;
	}

	computeCachedLadder() {
		let leaders = Object.keys(this.leaderboard);
		let ladder = [];
		let ranks: AnyObject = {};
		for (const leader of leaders) {
			ranks[leader] = [];
		}
		for (let i = 0; i < 3; i++) {
			leaders.sort((a, b) => this.leaderboard[b][i] - this.leaderboard[a][i]);

			let max = Infinity;
			let rank = -1;
			for (const leader of leaders) {
				let score = this.leaderboard[leader][i];
				if (max !== score) {
					rank++;
					max = score;
				}
				if (i === 0 && rank < 15) {
					if (!ladder[rank]) ladder[rank] = [];
					ladder[rank].push(leader as never);
				}
				ranks[leader].push(rank + 1);
			}
		}
		return {ladder, ranks};
	}
}

let cachedLadder = new Ladder(triviaData.leaderboard);
let cachedAltLadder = new Ladder(triviaData.altLeaderboard);

class TriviaPlayer extends Rooms.RoomGamePlayer {
	points: number;
	correctAnswers: number;
	answer: string;
	currentAnsweredAt: number[];
	lastQuestion: number;
	answeredAt: number[];
	isCorrect: boolean;
	isAbsent: boolean;
	player: any;
	constructor(user: User, game: Trivia) {
		super(user, game);

		this.points = 0;
		this.correctAnswers = 0;

		this.answer = '';
		this.currentAnsweredAt = [];
		this.lastQuestion = 0;
		this.answeredAt = [];
		this.isCorrect = false;
		this.isAbsent = false;
	}

	/**
	 * @param {string} answer
	 * @param {boolean?} isCorrect
	 */
	setAnswer(answer: string, isCorrect?: boolean) {
		this.answer = answer;
		this.currentAnsweredAt = process.hrtime();
		this.isCorrect = !!isCorrect;
	}

	incrementPoints(points = 0, lastQuestion: number) {
		this.points += points;
		this.answeredAt = this.currentAnsweredAt;
		this.lastQuestion = lastQuestion;
		this.correctAnswers++;
	}

	clearAnswer() {
		this.answer = '';
		this.isCorrect = false;
	}

	toggleAbsence() {
		this.isAbsent = !this.isAbsent;
	}

	reset() {
		this.points = 0;
		this.correctAnswers = 0;
		this.answer = '';
		this.answeredAt = [];
		this.isCorrect = false;
	}
}

class Trivia extends Rooms.RoomGame {
	gameid: ID;
	minPlayers: number;
	kickedUsers: Set<string>;
	canLateJoin: boolean;
	length: string;
	category: string;
	questions: TriviaQuestions;
	phase: string;
	phaseTimeout: NodeJS.Timeout | null;
	curQuestion: TriviaQuestion | string | undefined;
	curAnswers: string[];
	askedAt: number[];
	mode: string;
	questionNumber: number;
	constructor(room: Room, mode: string, category: string, length: string, questions: TriviaQuestion[]) {
		super(room as ChatRoom | GameRoom);
		this.gameid = 'trivia' as ID;
		this.title = 'Trivia';
		this.allowRenames = true;
		this.playerCap = Number.MAX_SAFE_INTEGER;

		this.minPlayers = MINIMUM_PLAYERS;
		this.kickedUsers = new Set();
		this.canLateJoin = true;
		this.mode = MODES[mode];
		this.length = length;
		this.category = '';
		if (category === 'all') {
			this.category = 'All';
		} else if (category === 'random') {
			this.category = `Random (${ALL_CATEGORIES[questions[0].category]})`;
		} else {
			this.category = ALL_CATEGORIES[category];
		}

		this.phase = SIGNUP_PHASE;
		this.phaseTimeout = null;

		this.questionNumber = 0;
		this.questions = questions;
		this.curQuestion = '';
		this.curAnswers = [];
		this.askedAt = [];

		this.init();
	}

	setPhaseTimeout(callback: any, timeout: number) {
		if (this.phaseTimeout) {
			clearTimeout(this.phaseTimeout);
		}
		this.phaseTimeout = setTimeout(callback, timeout);
	}

	getCap() {
		return LENGTHS[this.length].cap;
	}

	/**
	 * How long the players should have to answer a question.
	 * @return {number}
	 */
	getRoundLength() {
		return 12 * 1000 + 500;
	}

	addPlayer(user: User): Rooms.RoomGamePlayer | null {
		if (this.playerTable[user.id]) return 'You have already signed up for this game.';
		for (let id in user.prevNames) {
			if (this.playerTable[id]) return 'You have already signed up for this game.';
		}
		if (this.kickedUsers.has(user.id)) {
			return 'You were kicked from the game and thus cannot join it again.';
		}
		for (let id in user.prevNames) {
			if (this.playerTable[id]) return 'You have already signed up for this game.';
			if (this.kickedUsers.has(id)) return 'You were kicked from the game and cannot join until the next game.';
		}

		for (let id in this.playerTable) {
			let tarUser = Users.get(id);
			if (tarUser) {
				if (tarUser.prevNames[user.id]) return 'You have already signed up for this game.';

				let tarPrevNames = Object.keys(tarUser.prevNames);
				let prevNameMatch = tarPrevNames.some(tarId => (tarId in user.prevNames));
				if (prevNameMatch) return 'You have already signed up for this game.';

				let tarIps = Object.keys(tarUser.ips);
				let ipMatch = tarIps.some(ip => (ip in user.ips));
				if (ipMatch) return 'You have already signed up for this game.';
			}
		}
		if (this.phase !== SIGNUP_PHASE && !this.canLateJoin) return "This game does not allow latejoins.";
		super.addPlayer(user);
	}

	makePlayer(user: User) {
		return new TriviaPlayer(user, this);
	}

	destroy() {
		if (this.phaseTimeout) clearTimeout(this.phaseTimeout);
		this.phaseTimeout = null;
		this.kickedUsers.clear();
		super.destroy();
	}

	onConnect(user: User) {
		let player = this.playerTable[user.id];
		if (!player || !player.isAbsent) return false;
		player.toggleAbsence();
		if (++this.playerCount < MINIMUM_PLAYERS) return false;
		if (this.phase !== LIMBO_PHASE) return false;

		// At least let the game start first!!
		if (this.phase === SIGNUP_PHASE) return false;

		for (let i in this.playerTable) {
			this.playerTable[i].clearAnswer();
		}

		this.broadcast(
			'Enough players have returned to continue the game!',
			'The game will continue with the next question.'
		);
		this.askQuestion();
		return true;
	}

	/**
	 * @param {User} user
	 * @param {ID} oldUserid
	 */
	onLeave(user: User, oldUserid: ID) {
		// The user cannot participate, but their score should be kept
		// regardless in cases of disconnects.
		const player = this.playerTable[oldUserid || user.id];
		if (!player || player.isAbsent) return false;

		player.toggleAbsence();
		if (--this.playerCount >= MINIMUM_PLAYERS) return false;

		// At least let the game start first!!
		if (this.phase === SIGNUP_PHASE) return false;

		if (this.phaseTimeout) clearTimeout(this.phaseTimeout);
		this.phaseTimeout = null;
		this.phase = LIMBO_PHASE;
		this.broadcast(
			'Not enough players are participating to continue the game!',
			`Until there are ${MINIMUM_PLAYERS} players participating and present, the game will be paused.`
		);
		return true;
	}

	/**
	 * Handles setup that shouldn't be done from the constructor.
	 */
	init() {
		this.broadcast(
			'Signups for a new trivia game have begun!',
			`Mode: ${this.mode} | Category: ${this.category} | Score cap: ${this.getCap()}<br />` +
			'Enter /trivia join to sign up for the trivia game.'
		);
	}

	/**
	 * Generates and broadcasts the HTML for a generic announcement containing
	 * a title and an optional message.
	 * @param {string} title
	 * @param {string?} message
	 * @return {?ChatRoom}
	 */
	broadcast(title: string, message?: string) {
		let buffer = `<div class="broadcast-blue"><strong>${title}</strong>`;
		if (message) buffer += `<br />${message}`;
		buffer += '</div>';

		if (!this.room) return null;
		return this.room.addRaw(buffer).update();
	}

	/**
	 * @return {string}
	 */
	getDescription() {
		return `Mode: ${this.mode} | Category: ${this.category} | Score cap: ${this.getCap()}`;
	}

	/**
	 * Formats the player list for display when using /trivia players.
	 * @return {string}
	 */
	formatPlayerList(settings: string) {
		return this.getTopPlayers(settings).map((player: TriviaPlayer) => {
			const buf = Chat.html`${player.name} (${player.player.points || "0"})`;
			return player.isAbsent ? `<span style="color: #444444">${buf}</span>` : buf;
		}).join(', ');
	}

	/**
	 * Kicks a player from the game, preventing them from joining it again
	 * until the next game begins.
	 * @return {string}
	 */
	kick(tarUser: User, user: User) {
		if (!this.playerTable[tarUser.id]) {
			if (this.kickedUsers.has(tarUser.id)) return `User ${tarUser.name} has already been kicked from the game.`;

			for (let id in tarUser.prevNames) {
				if (this.kickedUsers.has(id)) return `User ${tarUser.name} has already been kicked from the game.`;
			}

			for (const kickedUserid of this.kickedUsers) {
				let kickedUser = Users.get(kickedUserid);
				if (kickedUser) {
					if (kickedUser.prevNames[tarUser.id]) {
						return `User ${tarUser.name} has already been kicked from the game.`;
					}

					let prevNames = Object.keys(kickedUser.prevNames);
					let nameMatch = prevNames.some(id => tarUser.prevNames[id]);
					if (nameMatch) return `User ${tarUser.name} has already been kicked from the game.`;

					let ips = Object.keys(kickedUser.ips);
					let ipMatch = ips.some(ip => tarUser.ips[ip]);
					if (ipMatch) return `User ${tarUser.name} has already been kicked from the game.`;
				}
			}

			return `User ${tarUser.name} is not a player in the game.`;
		}

		this.kickedUsers.add(tarUser.id);
		for (let id in tarUser.prevNames) {
			this.kickedUsers.add(id);
		}

		super.removePlayer(tarUser);
	}

	/**
	 * @param {User} user
	 * @return {string | undefined}
	 */
	leave(user: User) {
		if (!this.playerTable[user.id]) {
			return 'You are not a player in the current game.';
		}
		super.removePlayer(user);
	}

	/**
	 * Starts the question loop for a trivia game in its signup phase.
	 * @return {string | undefined}
	 */
	start() {
		if (this.phase !== SIGNUP_PHASE) return 'The game has already been started.';
		if (this.playerCount < this.minPlayers) {
			return `Not enough players have signed up yet! At least ${this.minPlayers} players to begin.`;
		}

		this.broadcast(`The game will begin in ${START_TIMEOUT / 1000} seconds...`);
		this.phase = INTERMISSION_PHASE;
		this.setPhaseTimeout(() => this.askQuestion(), START_TIMEOUT);
	}

	/**
	 * Broadcasts the next question on the questions list to the room and sets
	 * a timeout to tally the answers received.
	 */
	askQuestion() {
		if (!this.questions.length) {
			if (this.phaseTimeout) clearTimeout(this.phaseTimeout);
			this.phaseTimeout = null;
			this.broadcast(
				'No questions are left!',
				'The game has reached a stalemate'
			);
			if (this.room) this.destroy();
			return;
		}

		this.phase = QUESTION_PHASE;
		this.askedAt = process.hrtime();

		let question = this.questions.pop();
		this.questionNumber++;
		this.curQuestion = question;
		this.curAnswers = question!.answers;
		this.sendQuestion(question!);

		this.setPhaseTimeout(() => this.tallyAnswers(), this.getRoundLength());
	}

	/**
	 * Broadcasts to the room what the next question is.
	 * @param {TriviaQuestion} question
	 */
	sendQuestion(question: TriviaQuestion) {
		this.broadcast(
			`Question: ${question.question}`,
			`Category: ${ALL_CATEGORIES[question.category]}`
		);
	}

	/**
	 * This is a noop here since it'd defined properly by subclasses later on.
	 * All this is obligated to do is take a user and their answer as args;
	 * the behaviour of this method can be entirely arbitrary otherwise.
	 */
	answerQuestion() {}

	/**
	 * Verifies whether or not an answer is correct. In longer answers, small
	 * typos can be made and still have the answer be considered correct.
	 * @param {string} tarAnswer
	 * @return {boolean}
	 */
	verifyAnswer(tarAnswer: string) {
		return this.curAnswers.some(answer => (
			(answer === tarAnswer) || (Dex.levenshtein(tarAnswer, answer) <= this.maxLevenshteinAllowed(answer.length))
		));
	}

	/**
	 * Return the maximum Levenshtein distance that is allowable for answers of the given length.
	 * @param {number} answerLength
	 * @return {number}
	 */
	maxLevenshteinAllowed(answerLength: number) {
		if (answerLength > 5) {
			return 2;
		}

		if (answerLength > 4) {
			return 1;
		}

		return 0;
	}
	/**
	 * This is a noop here since it'd defined properly by mode subclasses later
	 * on. This calculates the points a correct responder earns, which is
	 * typically between 1-5.
	 */
	calculatePoints() {}

	/**
	 * This is a noop here since it's defined properly by mode subclasses later
	 * on. This is obligated to update the game phase, but it can be entirely
	 * arbitrary otherwise.
	 */
	tallyAnswers() {}

	/**
	 * Ends the game after a player's score has exceeded the score cap.
	 * @param {string} buffer
	 */
	win(buffer: string) {
		if (this.phaseTimeout) clearTimeout(this.phaseTimeout);
		this.phaseTimeout = null;
		const winners = this.getTopPlayers(3);
		buffer += '<br />' + this.getWinningMessage(winners);
		this.broadcast('The answering period has ended!', buffer);

		for (const userid in this.playerTable) {
			let player = this.playerTable[userid];
			if (!player.points) continue;

			for (const leaderboard of [triviaData.leaderboard, triviaData.altLeaderboard]) {
				if (!leaderboard![userid]) {
					leaderboard![userid] = [0, 0, 0];
				}
				let rank = leaderboard![userid];
				rank[1] += player.points;
				rank[2] += player.correctAnswers;
			}
		}

		const prizes = this.getPrizes();
		triviaData.leaderboard![winners[0].id][0] += prizes[0];
		for (let i = 0; i < winners.length; i++) {
			triviaData.altLeaderboard![winners[i].id][0] += prizes[i];
		}

		cachedLadder.invalidateCache();
		cachedAltLadder.invalidateCache();

		for (let i in this.playerTable) {
			let player = this.playerTable[i];
			let user = Users.get(player.id);
			if (!user) continue;
			user.sendTo(
				this.room.roomid,
				`You gained ${player.points} and answered ` +
				`${player.correctAnswers} questions correctly.`
			);
		}

		const buf = this.getStaffEndMessage(winners, (winner: TriviaPlayer) => winner.player.name);
		const logbuf = this.getStaffEndMessage(winners, (winner: TriviaPlayer) => winner.id);
		this.room.sendMods(buf);
		this.room.roomlog(buf);
		this.room.modlog(`(${this.room.roomid}) ${logbuf}`);

		writeTriviaData();
		this.destroy();
	}

	getPrizes() {
		return LENGTHS[this.length].prizes;
	}

	getTopPlayers(max: number | null = null, requirePoints = true) {
		const ranks = [];
		for (const userid in this.playerTable) {
			const user = Users.get(userid);
			const player = this.playerTable[userid];
			if ((requirePoints && !player.points) || !user) continue;
			ranks.push({id: userid, player, name: user.name});
		}
		ranks.sort((a, b) => {
			return b.player.points! - a.player.points! ||
				a.player.lastQuestion - b.player.lastQuestion ||
				hrtimeToNanoseconds(a.player.answeredAt) - hrtimeToNanoseconds(b.player.answeredAt);
		});
		return max === null ? ranks : ranks.slice(0, max);
	}

	getWinningMessage(winners: User[]) {
		const prizes = this.getPrizes();
		const [p1, p2, p3] = winners;
		const initialPart = Chat.html`${p1.name} won the game with a final score of <strong>${p1.player.points}</strong>, and `;
		switch (winners.length) {
		case 1:
			return `${initialPart}their leaderboard score has increased by <strong>${prizes[0]}</strong> points!`;
		case 2:
			return `${initialPart}their leaderboard score has increased by <strong>${prizes[0]}</strong> points! ` +
				Chat.html`${p2.name} was a runner-up and their leaderboard score has increased by <strong>${prizes[1]}</strong> points!`;
		case 3:
			return initialPart + Chat.html`${p2.name} and ${p3.name} were runners-up. ` +
				`Their leaderboard score has increased by ${prizes[0]}, ${prizes[1]}, and ${prizes[2]}, respectively!`;
		}
	}

	getStaffEndMessage(winners: string[], mapper: Function) {
		let message = "";
		const winnerParts = [
			(winner: string) => `User ${mapper(winner)} won the game of ${this.mode}` +
				` mode trivia under the ${this.category} category with a cap of ` +
				`${this.getCap()} points, with ${winner.player.points} points and ` +
				`${winner.player.correctAnswers} correct answers!`,
			(winner: string) => ` Second place: ${mapper(winner)} (${winner.player.points} points)`,
			(winner: string) => `, third place: ${mapper(winner)} (${winner.player.points} points)`,
		];
		for (let i = 0; i < winners.length; i++) {
			message += winnerParts[i](winners[i]);
		}
		return `(${message})`;
	}

	/**
	 * @param {User} user
	 */
	end(user: User) {
		this.broadcast(Chat.html`The game was forcibly ended by ${user.name}.`);
		this.destroy();
	}
}

/**
 * Helper function for timer and number modes. Milliseconds are not precise
 * enough to score players properly in rare cases.
 * @param {[number, number]} hrtime
 * @return {number}
 */
const hrtimeToNanoseconds = (hrtime: number[]) => hrtime[0] * 1e9 + hrtime[1];

/**
 * First mode rewards points to the first user to answer the question
 * correctly.
 */
class FirstModeTrivia extends Trivia {
	/**
	 * @param {string} answer
	 * @param {User} user
	 * @return {string | undefined}
	 */
	answerQuestion(answer, user) {
		let player = this.playerTable[user.id];
		if (!player) return 'You are not a player in the current trivia game.';
		if (this.phase !== QUESTION_PHASE) return 'There is no question to answer.';
		if (player.answer) return 'You have already attempted to answer the current question.';
		if (!this.verifyAnswer(answer)) return;

		clearTimeout(this.phaseTimeout);
		this.phase = INTERMISSION_PHASE;

		let points = this.calculatePoints();
		player.setAnswer(answer);
		player.incrementPoints(points, this.questionNumber);

		let buffer = Chat.html`Correct: ${user.name}<br />` +
			`Answer(s): ${this.curAnswers.join(', ')}<br />` +
			'They gained <strong>5</strong> points!<br />' +
			`The top 5 players are: ${this.formatPlayerList({max: 5})}`;
		if (player.points >= this.getCap()) {
			this.win(buffer);
			return;
		}

		for (let i in this.playerTable) {
			this.playerTable[i].clearAnswer();
		}

		this.broadcast('The answering period has ended!', buffer);
		this.setPhaseTimeout(() => this.askQuestion(), INTERMISSION_INTERVAL);
	}

	/**
	 * @return {number}
	 */
	calculatePoints() {
		return 5;
	}

	tallyAnswers() {
		this.phase = INTERMISSION_PHASE;

		for (let i in this.playerTable) {
			let player = this.playerTable[i];
			player.clearAnswer();
		}

		this.broadcast(
			'The answering period has ended!',
			'Correct: no one...<br />' +
			`Answers: ${this.curAnswers.join(', ')}<br />` +
			'Nobody gained any points.<br />' +
			`The top 5 players are: ${this.formatPlayerList({max: 5})}`
		);

		this.setPhaseTimeout(() => this.askQuestion(), INTERMISSION_INTERVAL);
	}
}

/**
 * Timer mode rewards up to 5 points to all players who answer correctly
 * depending on how quickly they answer the question.
 */
class TimerModeTrivia extends Trivia {
	/**
	 * @param {string} answer
	 * @param {User} user
	 * @return {string | undefined}
	 */
	answerQuestion(answer, user) {
		let player = this.playerTable[user.id];
		if (!player) return 'You are not a player in the current trivia game.';
		if (this.phase !== QUESTION_PHASE) return 'There is no question to answer.';

		let isCorrect = this.verifyAnswer(answer);
		player.setAnswer(answer, isCorrect);
	}

	/**
	 * @param {number} diff
	 * The difference between the time the player answered the question and
	 * when the question was asked, in nanoseconds.
	 * @param {number} totalDiff
	 * The difference between the time scoring began and the time the question
	 * was asked, in nanoseconds.
	 * @return {number}
	 */
	calculatePoints(diff, totalDiff) {
		return Math.floor(6 - 5 * diff / totalDiff);
	}

	tallyAnswers() {
		this.phase = INTERMISSION_PHASE;

		let buffer = (
			`Answer(s): ${this.curAnswers.join(', ')}<br />` +
			'<table style="width: 100%; background-color: #9CBEDF; margin: 2px 0">' +
				'<tr style="background-color: #6688AA">' +
					'<th style="width: 100px">Points gained</th>' +
					'<th>Correct</th>' +
				'</tr>'
		);
		let innerBuffer = new Map([5, 4, 3, 2, 1].map(n => [n, []]));

		let winner = false;

		let now = hrtimeToNanoseconds(process.hrtime());
		let askedAt = hrtimeToNanoseconds(this.askedAt);
		let totalDiff = now - askedAt;
		for (let i in this.playerTable) {
			let player = this.playerTable[i];
			if (!player.isCorrect) {
				player.clearAnswer();
				continue;
			}

			let playerAnsweredAt = hrtimeToNanoseconds(player.currentAnsweredAt);
			let diff = playerAnsweredAt - askedAt;
			let points = this.calculatePoints(diff, totalDiff);
			player.incrementPoints(points, this.questionNumber);

			let pointBuffer = innerBuffer.get(points);
			pointBuffer.push([Chat.escapeHTML(player.name), playerAnsweredAt]);

			if (player.points >= this.getCap()) {
				winner = true;
			}

			player.clearAnswer();
		}

		let rowAdded = false;
		for (let [pointValue, players] of innerBuffer) {
			if (!players.length) continue;

			rowAdded = true;
			players = players
				.sort((a, b) => a[1] - b[1])
				.map(a => a[0]);
			buffer += (
				'<tr style="background-color: #6688AA">' +
				`<td style="text-align: center">${pointValue}</td>` +
				`<td>${players.join(', ')}</td>` +
				'</tr>'
			);
		}

		if (!rowAdded) {
			buffer += (
				'<tr style="background-color: #6688AA">' +
				'<td style="text-align: center">&#8212;</td>' +
				'<td>No one answered correctly...</td>' +
				'</tr>'
			);
		}

		buffer += '</table>';

		if (winner) return this.win(buffer);

		buffer += `<br />The top 5 players are: ${this.formatPlayerList({max: 5})}`;
		this.broadcast('The answering period has ended!', buffer);
		this.setPhaseTimeout(() => this.askQuestion(), INTERMISSION_INTERVAL);
	}
}

/**
 * Number mode rewards up to 5 points to all players who answer correctly
 * depending on the ratio of correct players to total players (lower ratio is
 * better).
 */
class NumberModeTrivia extends Trivia {
	/**
	 * @param {string} answer
	 * @param {User} user
	 * @return {string | undefined}
	 */
	answerQuestion(answer, user) {
		let player = this.playerTable[user.id];
		if (!player) return 'You are not a player in the current trivia game.';
		if (this.phase !== QUESTION_PHASE) return 'There is no question to answer.';

		let isCorrect = this.verifyAnswer(answer);
		player.setAnswer(answer, isCorrect);
	}

	/**
	 * @param {number} correctPlayers
	 * @return {number}
	 */
	calculatePoints(correctPlayers) {
		return correctPlayers && (6 - Math.floor(5 * correctPlayers / this.playerCount));
	}

	getRoundLength() {
		return 6 * 1000;
	}

	tallyAnswers() {
		this.phase = INTERMISSION_PHASE;

		let buffer;
		let innerBuffer = Object.keys(this.playerTable)
			.filter(id => this.playerTable[id].isCorrect)
			.map(id => {
				let player = this.playerTable[id];
				return [Chat.escapeHTML(player.name), hrtimeToNanoseconds(player.currentAnsweredAt)];
			})
			.sort((a, b) => a[1] - b[1]);

		let points = this.calculatePoints(innerBuffer.length);
		if (points) {
			let winner = false;
			for (let i in this.playerTable) {
				let player = this.playerTable[i];
				if (player.isCorrect) player.incrementPoints(points, this.questionNumber);

				if (player.points >= this.getCap()) {
					winner = true;
				}

				player.clearAnswer();
			}

			buffer = `Correct: ${innerBuffer.map(arr => arr[0]).join(', ')}<br />` +
				`Answer(s): ${this.curAnswers.join(', ')}<br />` +
				`${Chat.plural(innerBuffer, "Each of them", "They")} gained <strong>${points}</strong> point(s)!`;

			if (winner) return this.win(buffer);
		} else {
			for (let i in this.playerTable) {
				let player = this.playerTable[i];
				player.clearAnswer();
			}

			buffer = 'Correct: no one...<br />' +
				`Answer(s): ${this.curAnswers.join(', ')}<br />` +
				'Nobody gained any points.';
		}

		buffer += `<br />The top 5 players are: ${this.formatPlayerList({max: 5})}.`;
		this.broadcast('The answering period has ended!', buffer);
		this.setPhaseTimeout(() => this.askQuestion(), INTERMISSION_INTERVAL);
	}
}

const commands: ChatCommands = {
	new(target, room, user) {
		if (room.roomid !== 'trivia') return this.errorReply("This command can only be used in the Trivia room.");
		if (!this.can('broadcast', null, room) || !target) return false;
		if (!this.canTalk()) return;
		if (room.game) {
			return this.errorReply(`There is already a game of ${room.game.title} in progress.`);
		}

		let tars = target.split(',');
		if (tars.length < 2) return this.errorReply("Invalid arguments specified.");

		let mode = toID(tars[0]);
		if (!MODES[mode]) return this.errorReply(`"${mode}" is an invalid mode.`);

		let category = toID(tars[1]);
		let isRandom = (category === 'random');
		let isAll = (category === 'all');
		let questions;
		if (isRandom) {
			let categories = Object.keys(MAIN_CATEGORIES);
			let randCategory = categories[Math.floor(Math.random() * categories.length)];
			questions = sliceCategory(randCategory);
		} else if (isAll) {
			questions = triviaData.questions!.slice();
			for (const category in SPECIAL_CATEGORIES) {
				questions = questions.filter(q => q.category !== category);
			}
		} else if (ALL_CATEGORIES[category]) {
			questions = sliceCategory(category);
		} else {
			return this.errorReply(`"${category}" is an invalid category.`);
		}

		// Randomizes the order of the questions.
		let length;
			length = toID(tars[2]);
			if (!LENGTHS[length]) return this.errorReply(`"${length}" is an invalid game length.`);

			questions = questions.filter(q => q.type === 'trivia');
			if (questions.length < LENGTHS[length].cap / 5) {
				if (isRandom) return this.errorReply("There are not enough questions in the randomly chosen category to finish a trivia game.");
				if (isAll) return this.errorReply("There are not enough questions in the trivia database to finish a trivia game.");
				return this.errorReply(`There are not enough questions under the category "${ALL_CATEGORIES[category]}" to finish a trivia game.`);
		}

		let _Trivia;
		if (mode === 'first') {
			_Trivia = FirstModeTrivia;
		} else if (mode === 'timer') {
			_Trivia = TimerModeTrivia;
		} else if (mode === 'number') {
			_Trivia = NumberModeTrivia;
		} else {
			_Trivia = NumberModeTrivia;
		}
		questions = Dex.shuffle(questions);
		room.game = new _Trivia(room, mode, category, length, questions);
	},
	newhelp: [`/trivia new [mode], [category], [length] - Begin a new trivia game. Requires: + % @ # & ~`],

	join(target, room, user) {
		if (room.roomid !== 'trivia') return this.errorReply("This command can only be used in Trivia.");
		if (!room.game) return this.errorReply("There is no game of trivia in progress.");
		if (room.game.gameid !== 'trivia') {
			return this.errorReply(`There is already a game of ${room.game.title} in progress.`);
		}
		let res = room.game.addPlayer(user);
		if (res) return this.errorReply(res);
		this.sendReply('You are now signed up for this game!');
	},
	joinhelp: [`/trivia join - Join the current trivia game.`],

	kick(target, room, user) {
		if (room.roomid !== 'trivia') return this.errorReply("This command can only be used in Trivia.");
		if (!this.can('mute', null, room)) return false;
		if (!this.canTalk()) return;
		if (!room.game) return this.errorReply("There is no game of trivia in progress.");
		if (room.game.gameid !== 'trivia') {
			return this.errorReply(`There is already a game of ${room.game.title} in progress.`);
		}

		this.splitTarget(target);
		let targetUser = this.targetUser;
		if (!targetUser) return this.errorReply(`The user "${target}" does not exist.`);

		let res = room.game.kick(targetUser, user);
		if (res) return this.errorReply(res);
		// ...
	},
	kickhelp: [`/trivia kick [username] - Kick players from a trivia game by username. Requires: % @ # & ~`],

	leave(target, room, user) {
		if (room.roomid !== 'trivia') return this.errorReply("This command can only be used in Trivia.");
		if (!room.game) return this.errorReply("There is no game of trivia in progress.");
		if (room.game.gameid !== 'trivia') {
			return this.errorReply(`There is already a game of ${room.game.title} in progress.`);
		}

		let res = room.game.leave(user);
		if (typeof res === 'string') return this.errorReply(res);
		this.sendReply("You have left the current game of trivia.");
	},
	leavehelp: [`/trivia leave - Makes the player leave the game.`],

	start(target, room) {
		if (room.roomid !== 'trivia') return this.errorReply("This command can only be used in Trivia.");
		if (!this.can('broadcast', null, room)) return false;
		if (!this.canTalk()) return;
		if (!room.game) return this.errorReply("There is no game of trivia in progress.");
		if (room.game.gameid !== 'trivia') {
			return this.errorReply(`There is already a game of ${room.game.title} in progress.`);
		}

		let res = room.game.start();
		if (res) return this.errorReply(res);
		// ...
	},
	starthelp: [`/trivia start - Ends the signup phase of a trivia game and begins the game. Requires: + % @ # & ~`],

	answer(target, room, user) {
		if (room.roomid !== 'trivia') return this.errorReply("This command can only be used in Trivia.");
		if (!room.game) return this.errorReply("There is no game of trivia in progress.");
		if (room.game.gameid !== 'trivia') {
			return this.errorReply(`There is already a game of ${room.game.title} in progress.`);
		}

		let answer = toID(target);
		if (!answer) return this.errorReply("No valid answer was entered.");

		let res = room.game.answerQuestion(answer, user);
		if (res) return this.errorReply(res);
		this.sendReply(`You have selected "${answer}" as your answer.`);
	},
	answerhelp: [`/trivia answer OR /ta [answer] - Answer a pending question.`],

	end(target, room, user) {
		if (room.roomid !== 'trivia') return this.errorReply("This command can only be used in Trivia.");
		if (!this.can('broadcast', null, room)) return false;
		if (!this.canTalk()) return;
		if (!room.game) return this.errorReply("There is no game of trivia in progress.");
		if (room.game.gameid !== 'trivia') {
			return this.errorReply(`There is already a game of ${room.game.title} in progress.`);
		}

		room.game.end(user);
	},
	endhelp: [`/trivia end - Forcibly end a trivia game. Requires: + % @ # & ~`],

	'': 'status',
	players: 'status',
	status(target, room, user) {
		if (room.roomid !== 'trivia') return this.errorReply("This command can only be used in Trivia.");
		if (!this.runBroadcast()) return false;
		if (!room.game) return this.errorReply("There is no game of trivia in progress.");
		if (room.game.gameid !== 'trivia') {
			return this.errorReply(`There is already a game of ${room.game.title} in progress.`);
		}

		let tarUser;
		if (target) {
			this.splitTarget(target);
			if (!this.targetUser) return this.errorReply(`User ${target} does not exist.`);
			tarUser = this.targetUser;
		} else {
			tarUser = user;
		}

		let game = room.game;
		let buffer = `There is a trivia game in progress, and it is in its ${game.phase} phase.<br />` +
			`Mode: ${game.mode} | Category: ${game.category} | Score cap: ${game.getCap()}`;

		let player = game.playerTable[tarUser.id];
		if (player) {
			if (!this.broadcasting) {
				buffer += `<br />Current score: ${player.points} | Correct Answers: ${player.correctAnswers}`;
			}
		} else if (tarUser.id !== user.id) {
			return this.errorReply(`User ${tarUser.name} is not a player in the current trivia game.`);
		}

		buffer += `<br />Players: ${room.game.formatPlayerList({requirePoints: false})}`;

		this.sendReplyBox(buffer);
	},
	statushelp: [`/trivia status [player] - lists the player's standings (your own if no player is specified) and the list of players in the current trivia game.`],

	submit: 'add',
	add(target, room, user, connection, cmd) {
		if (room.roomid !== 'questionworkshop') return this.errorReply('This command can only be used in Question Workshop.');
		if (cmd === 'add' && !this.can('mute', null, room)) return false;
		if (cmd === 'submit' && !this.can('broadcast', null, room)) return false;
		if (!target) return false;
		if (!this.canTalk()) return false;

		const params = target.split('\n');
		for (let param of params) {
			param = param.split('|');
			if (param.length !== 3) {
				this.errorReply(`Invalid arguments specified in "${param}". View /trivia help for more information.`);
				continue;
			}

			let category = toID(param[0]);
			if (!ALL_CATEGORIES[category]) {
				this.errorReply(`'${param[0].trim()}' is not a valid category. View /trivia help for more information.`);
				continue;
			}
			if (cmd === 'submit' && !MAIN_CATEGORIES[category]) {
				this.errorReply(`You cannot submit questions in the '${ALL_CATEGORIES[category]}' category`);
				continue;
			}

			let question = Chat.escapeHTML(param[1].trim());
			if (!question) {
				this.errorReply(`'${param[1].trim()}' is not a valid question.`);
				continue;
			}
			if (question.length > MAX_QUESTION_LENGTH) {
				this.errorReply(`Question "${param[1].trim()}" is too long! It must remain under ${MAX_QUESTION_LENGTH} characters.`);
				continue;
			}
			if (triviaData.submissions.some(s => s.question === question) || triviaData.questions.some(q => q.question === question)) {
				this.errorReply(`Question "${question}" is already in the trivia database.`);
				continue;
			}

			let cache = new Set();
			let answers = param[2].split(',')
				.map(toID)
				.filter(answer => !cache.has(answer) && !!cache.add(answer));
			if (!answers.length) {
				this.errorReply(`No valid answers were specified for question '${param[1].trim()}'.`);
				continue;
			}
			if (answers.some(answer => answer.length > MAX_ANSWER_LENGTH)) {
				this.errorReply(`Some of the answers entered for question '${param[1].trim()}' were too long! They must remain under ${MAX_ANSWER_LENGTH} characters.`);
				continue;
			}

			let entry = {
				category: category,
				question: question,
				answers: answers,
				user: user.id,
			};

			if (cmd === 'add') {
				triviaData.questions!.splice(findEndOfCategory(category, false), 0, entry);
				writeTriviaData();
				this.modlog('TRIVIAQUESTION', null, `added to Trivia - '${param[1]}'`);
				this.privateModAction(`(Question '${param[1]}' was added to the Trivia question database by ${user.name}.)`);
			} else {
				triviaData.submissions!.splice(findEndOfCategory(category, true), 0, entry);
				writeTriviaData();
				if (!user.can('mute', null, room)) this.sendReply(`Question '${param[1]}' was submitted for review.`);
				this.modlog('TRIVIAQUESTION', null, `submitted to Trivia '${param[1]}'`);
				this.privateModAction(`(Question '${param[1]}' was submitted to the Trivia submission database by ${user.name} for review.)`);
			}
		}
	},
	submithelp: [`/trivia submit [category] | [question] | [answer1], [answer2] ... [answern] - Adds question(s) to the submission database for staff to review. Requires: + % @ # & ~`],
	addhelp: [`/trivia add [category] | [question] | [answer1], [answer2], ... [answern] - Adds question(s) to the question database. Requires: % @ # & ~`],

	review(target, room) {
		if (room.roomid !== 'questionworkshop') return this.errorReply('This command can only be used in Question Workshop.');
		if (!this.can('ban', null, room)) return false;

		let submissions = triviaData.submissions;
		let submissionsLen = submissions.length;
		if (!submissionsLen) return this.sendReply("No questions await review.");

		let buffer = `|raw|<div class="ladder"><table>` +
			`<tr><td colspan="6"><strong>${Chat.count(submissionsLen, "</strong> questions")} awaiting review:</td></tr>` +
			"<tr><th>#</th><th>Category</th><th>Question</th><th>Answer(s)</th><th>Submitted By</th><th>Type</th></tr>";

		let i = 0;
		while (i < submissionsLen) {
			let entry = submissions![i];
			buffer += `<tr><td><strong>${(++i)}</strong></td><td>${entry.category}</td><td>${entry.question}</td><td>${entry.answers.join(", ")}</td><td>${entry.user}</td><td>${TYPES[entry.type]}</td></tr>`;
		}
		buffer += "</table></div>";

		this.sendReply(buffer);
	},
	reviewhelp: [`/trivia review - View the list of submitted questions. Requires: @ # & ~`],

	reject: 'accept',
	accept(target, room, user, connection, cmd) {
		if (room.roomid !== 'questionworkshop') return this.errorReply('This command can only be used in Question Workshop.');
		if (!this.can('ban', null, room)) return false;
		if (!this.canTalk()) return;

		target = target.trim();
		if (!target) return false;

		let isAccepting = cmd === 'accept';
		let questions = triviaData.questions;
		let submissions = triviaData.submissions;

		if (toID(target) === 'all') {
			if (isAccepting) {
				for (const submission of submissions!) {
					questions!.splice(findEndOfCategory(submission.category, false), 0, submission);
				}
			}

			triviaData.submissions = [];
			writeTriviaData();
			this.modlog(`TRIVIAQUESTION`, null, `${(isAccepting ? "added" : "removed")} all from submission database.`);
			return this.privateModAction(`(${user.name} ${(isAccepting ? " added " : " removed ")} all questions from the submission database.)`);
		}

		if (/^\d+(?:-\d+)?(?:, ?\d+(?:-\d+)?)*$/.test(target)) {
			let indices = target.split(',');

			// Parse number ranges and add them to the list of indices,
			// then remove them in addition to entries that aren't valid index numbers
			for (let i = indices.length; i--;) {
				if (!indices[i].includes('-')) {
					let index = Number(indices[i]);
					if (Number.isInteger(index) && index > 0 && index <= submissions!.length) {
						indices[i] = index;
					} else {
						indices.splice(i, 1);
					}
					continue;
				}

				let range = indices[i].split('-');
				let left = Number(range[0]);
				let right = Number(range[1]);
				if (!Number.isInteger(left) || !Number.isInteger(right) ||
					left < 1 || right > submissions.length || left === right) {
					indices.splice(i, 1);
					continue;
				}

				do {
					indices.push(right);
				} while (--right >= left);

				indices.splice(i, 1);
			}

			indices.sort((a, b) => a - b);
			indices = indices.filter((entry, index) => !index || indices[index - 1] !== entry);

			let indicesLen = indices.length;
			if (!indicesLen) return this.errorReply(`'${target}' is not a valid set of submission index numbers. View /trivia review and /trivia help for more information.`);

			if (isAccepting) {
				for (let i = indicesLen; i--;) {
					let submission = submissions!.splice(indices[i] - 1, 1)[0];
					questions!.splice(findEndOfCategory(submission.category, false), 0, submission);
				}
			} else {
				for (let i = indicesLen; i--;) {
					submissions!.splice(indices[i] - 1, 1);
				}
			}

			writeTriviaData();
			this.modlog('TRIVIAQUESTION', null, `${(isAccepting ? "added " : "removed ")}submission number${(indicesLen > 1 ? "s " : " ")}${target}`);
			return this.privateModAction(`(${user.name} ${(isAccepting ? "added " : "removed ")}submission number${(indicesLen > 1 ? "s " : " ")}${target} from the submission database.)`);
		}

		this.errorReply(`'${target}' is an invalid argument. View /trivia help questions for more information.`);
	},
	accepthelp: [`/trivia accept [index1], [index2], ... [indexn] OR all - Add questions from the submission database to the question database using their index numbers or ranges of them. Requires: @ # & ~`],
	rejecthelp: [`/trivia reject [index1], [index2], ... [indexn] OR all - Remove questions from the submission database using their index numbers or ranges of them. Requires: @ # & ~`],

	delete(target, room, user) {
		if (room.roomid !== 'questionworkshop') return this.errorReply('This command can only be used in Question Workshop.');
		if (!this.can('mute', null, room)) return false;
		if (!this.canTalk()) return;

		target = target.trim();
		if (!target) return false;

		let question = Chat.escapeHTML(target);
		if (!question) return this.errorReply(`'${target}' is not a valid argument. View /trivia help questions for more information.`);

		let questions = triviaData.questions;
		let questionID = toID(question);
		for (const [i, question] of questions!.entries()) {
			if (toID(question.question) === questionID) {
				questions!.splice(i, 1);
				writeTriviaData();
				this.modlog('TRIVIAQUESTION', null, `removed '${target}'`);
				return this.privateModAction(`(${user.name} removed question '${target}' from the question database.)`);
			}
		}

		this.errorReply(`Question '${target}' was not found in the question database.`);
	},
	deletehelp: [`/trivia delete [question] - Delete a question from the trivia database. Requires: % @ # & ~`],

	move(target, room, user) {
		if (room.roomid !== 'questionworkshop') {
			return this.errorReply('This command can only be used in Question Workshop.');
		}
		if (!this.can('mute', null, room)) return false;
		if (!this.canTalk()) return;

		target = target.trim();
		if (!target) return false;

		const params = target.split('\n');
		for (let param of params) {
			param = param.split('|');
			if (param.length !== 2) {
				this.errorReply(`Invalid arguments specified in "${param}". View /trivia help for more information.`);
				continue;
			}

			let category = toID(param[0]);
			if (!ALL_CATEGORIES[category]) {
				this.errorReply(`'${param[0].trim()}' is not a valid category. View /trivia help for more information.`);
				continue;
			}

			let questionID = toID(Chat.escapeHTML(param[1].trim()));
			if (!questionID) {
				this.errorReply(`'${param[1].trim()}' is not a valid question.`);
				continue;
			}

			let questions = triviaData.questions;

			for (const [i, question] of questions!.entries()) {
				if (toID(question.question) === questionID) {
					if (question.category === category) {
						this.errorReply(`'${param[1].trim()}' is already in the category '${param[0].trim()}'.`);
						break;
					}
					questions!.splice(i, 1);
					question.category = category;
					questions!.splice(findEndOfCategory(category, false), 0, question);
					writeTriviaData();
					this.modlog('TRIVIAQUESTION', null, `changed category for '${param[1].trim()}' to '${param[0]}'`);
					return this.privateModAction(`(${user.name} changed question category to '${param[0]}' for '${param[1].trim()}' from the question database.)`);
				}
			}
		}
	},
	movehelp: [
		`/trivia move [category] | [question] - Change the category of question in the trivia databse. Requires: % @ # & ~`,
	],

	qs(target, room, user) {
		if (room.roomid !== 'questionworkshop') return this.errorReply('This command can only be used in Question Workshop.');

		let buffer = "|raw|<div class=\"ladder\" style=\"overflow-y: scroll; max-height: 300px;\"><table>";
		let isWL = (this.message.startsWith("/wlink"));
		if (!target) {
			if (!this.runBroadcast()) return false;

			let questions = triviaData.questions?.filter(q => q.type === "trivia");
			let questionsLen = questions!.length;
			if (!questionsLen) return this.sendReplyBox(`No questions have been submitted for Trivia yet.`);

			let lastCategoryIdx = 0;
			buffer += "<tr><th>Category</th><th>Question Count</th></tr>";
			for (const category in ALL_CATEGORIES) {
				if (category === 'random') continue;
				let tally = findEndOfCategory(category, false) - lastCategoryIdx;
				lastCategoryIdx += tally;
				buffer += `<tr><td>${ALL_CATEGORIES[category]}</td><td>${tally} (${((tally * 100) / questionsLen).toFixed(2)}%)</td></tr>`;
			}
			buffer += `<tr><td><strong>Total</strong></td><td><strong>${questionsLen}</strong></td></table></div>`;

			return this.sendReply(buffer);
		}

		if (!this.can('mute', null, room)) return false;

		let category = toID(target);
		if (category === 'random') return false;
		if (!ALL_CATEGORIES[category]) return this.errorReply(`'${target}' is not a valid category. View /help trivia for more information.`);

		const list = sliceCategory(category).filter(q => q.type === "trivia");
		if (!list.length) {
			buffer += `<tr><td>There are no questions in the ${ALL_CATEGORIES[target]} category for Trivia.</td></table></div>`;
			return this.sendReply(buffer);
		}

		if (user.can('ban', null, room)) {
			buffer += `<tr><td colspan="3">There are <strong>${list.length}</strong> questions in the ${ALL_CATEGORIES[target]} category for Trivia.</td></tr>` +
				"<tr><th>#</th><th>Question</th><th>Answer(s)</th></tr>";
			for (const [i, entry] of list.entries()) {
				buffer += `<tr><td><strong>${(i + 1)}</strong></td><td>${entry.question}</td><td>${entry.answers.join(", ")}</td><tr>`;
			}
		} else {
			buffer += `<td colspan="2">There are <strong>${list.length}</strong> questions in the ${target} category.</td></tr>` +
				"<tr><th>#</th><th>Question</th></tr>";
			for (const [i, entry] of list.entries()) {
				buffer += `<tr><td><strong>${(i + 1)}</strong></td><td>${entry.question}</td></tr>`;
			}
		}
		buffer += "</table></div>";

		this.sendReply(buffer);
	},
	qshelp: [
		"/trivia qs - View the distribution of questions in the question database.",
		"/trivia qs [category] - View the questions in the specified category. Requires: % @ # & ~",
	],

	search(target, room, user) {
		if (room.roomid !== 'questionworkshop') return this.errorReply("This command can only be used in Question Workshop.");
		if (!this.can('broadcast', null, room)) return false;
		if (!target.includes(',')) return this.errorReply("No valid search arguments entered.");

		let [type, ...query] = target.split(',');
		type = toID(type);
		if (/^q(?:uestion)?s?$/.test(type)) {
			type = 'questions';
		} else if (/^sub(?:mission)?s?$/.test(type)) {
			type = 'submissions';
		} else {
			return this.sendReplyBox("No valid search category was entered. Valid categories: submissions, subs, questions. qs");
		}

		const search = query.join(',').trim();
		if (!query) return this.errorReply("No valid search query as entered.");

		let results = triviaData[type].filter((q: TriviaQuestion) => q.question.includes(search) && !SPECIAL_CATEGORIES[q.category]);
		if (!results.length) return this.sendReply(`No results found under the ${type} list.`);

		let buffer = "|raw|<div class=\"ladder\"><table><tr><th>#</th><th>Category</th><th>Question</th></tr>" +
			`<tr><td colspan="3">There are <strong>${results.length}</strong> matches for your query:</td></tr>`;
		buffer += results.map((q: TriviaQuestion, i: number) => {
			return `<tr><td><strong>${i + 1}</strong></td><td>${q.category}</td><td>${q.question}</td></tr>`;
		}).join('');
		buffer += "</table></div>";

		this.sendReply(buffer);
	},
	searchhelp: [`/trivia search [type], [query] - Searches for questions based on their type and their query. Valid types: submissions, subs, questions, qs. Requires: + % @ * & ~`],

	rank(target, room, user) {
		if (room.roomid !== 'trivia') return this.errorReply("This command can only be used in Trivia.");

		let name;
		let userid;
		if (!target) {
			name = Chat.escapeHTML(user.name);
			userid = user.id;
		} else {
			this.splitTarget(target, true);
			name = Chat.escapeHTML(this.targetUsername);
			userid = toID(name);
		}

		let allTimeScore = triviaData.leaderboard![userid];
		if (!allTimeScore) return this.sendReplyBox(`User '${name}' has not played any trivia games yet.`);
		let score = triviaData.altLeaderboard![userid] || [0, 0, 0];

		let ranks = cachedAltLadder.get().ranks[userid];
		let allTimeRanks = cachedLadder.get().ranks[userid];
		const row = i => `<strong>${score[i]}</strong>${ranks ? ` (#${ranks[i]})` : ""}, ` +
			`all time: <strong>${allTimeScore[i]}</strong> (#${allTimeRanks ? allTimeRanks[i] : allTimeRanks.length})<br />`;
		this.sendReplyBox(
			`User: <strong>${name}</strong><br />` +
			`Leaderboard score: ${row(0)}` +
			`Total game points: ${row(1)}` +
			`Total correct answers: ${row(2)}`
		);
	},
	rankhelp: [`/trivia rank [username] - View the rank of the specified user. If no name is given, view your own.`],

	alltimeladder: 'ladder',
	ladder(target, room, user, connection, cmd) {
		if (room.roomid !== 'trivia') return this.errorReply('This command can only be used in Trivia.');
		if (!this.runBroadcast()) return false;
		let cache = cmd === 'ladder' ? cachedAltLadder : cachedLadder;
		let {ladder} = cache.get();
		let leaderboard = cache.leaderboard;
		if (!ladder.length) return this.errorReply("No trivia games have been played yet.");

		let buffer = "|raw|<div class=\"ladder\" style=\"overflow-y: scroll; max-height: 300px;\"><table>" +
			"<tr><th>Rank</th><th>User</th><th>Leaderboard score</th><th>Total game points</th><th>Total correct answers</th></tr>";
		let num = parseInt(target);
		if (!num || num < 0) num = 100;
		if (num > ladder.length) num = ladder.length;
		for (let i = Math.max(0, num - 100); i < num; i++) {
			let leaders = ladder[i];
			for (const leader of leaders) {
				let rank = leaderboard[leader];
				let leaderid = Users.getExact(leader);
				leaderid = leaderid ? Chat.escapeHTML(leaderid.name) : leader;
				buffer += `<tr><td><strong>${(i + 1)}</strong></td><td>${leaderid}</td><td>${rank[0]}</td><td>${rank[1]}</td><td>${rank[2]}</td></tr>`;
			}
		}
		buffer += "</table></div>";

		return this.sendReply(buffer);
	},
	ladderhelp: [`/trivia ladder [num] - View information about 15 users on the trivia leaderboard.`],
	alltimeladderhelp: [`/trivia ladder [num] - View information about 15 users on the all time trivia leaderboard.`],

	clearquestions: 'clearqs',
	clearqs(target, room, user) {
		if (room.roomid !== 'questionworkshop') return this.errorReply("This command can only be used in Question Workshop");
		if (!this.can('declare', null, room)) return false;
		const category = toID(target);
		if (ALL_CATEGORIES[category]) {
			if (SPECIAL_CATEGORIES[category]) {
				triviaData.questions = triviaData.questions!.filter(q => q.category !== category);
				writeTriviaData();
				return this.privateModAction(`(${user.name} removed all questions of category '${category}'.)`);
			} else {
				return this.errorReply(`You cannot clear the category '${ALL_CATEGORIES[category]}'.`);
			}
		} else {
			return this.errorReply(`'${category}' is an invalid category.`);
		}
	},
	clearqshelp: [`/trivia clears [category] - Remove all questions of the given category. Requires: # & ~`],

	help(target, room, user) {
		return this.parse("/help trivia");
	},
};

module.exports = {
	ALL_CATEGORIES,
	MAIN_CATEGORIES,
	SPECIAL_CATEGORIES,
	MODES,
	LENGTHS,

	triviaData,
	writeTriviaData,

	Trivia,
	FirstModeTrivia,
	TimerModeTrivia,
	NumberModeTrivia,

	commands: {
		trivia: commands,
		wlink: commands,
		ta: commands.answer,
		triviahelp: [
			`Modes:`,
			`- First: the first correct responder gains 5 points.`,
			`- Timer: each correct responder gains up to 5 points based on how quickly they answer.`,
			`- Number: each correct responder gains up to 5 points based on how many participants are correct.`,
			`Categories: Arts & Entertainment, Pok\u00e9mon, Science & Geography, Society & Humanities, Random, and All.`,
			`Game lengths:`,
			`- Short: 20 point score cap. The winner gains 3 leaderboard points.`,
			`- Medium: 35 point score cap. The winner gains 4 leaderboard points.`,
			`- Long: 50 point score cap. The winner gains 5 leaderboard points.`,
			`Game commands:`,
			`- /trivia new [mode], [category], [length] - Begin signups for a new trivia game. Requires: + % @ # & ~`,
			`- /trivia join - Join a trivia game during signups.`,
			`- /trivia start - Begin the game once enough users have signed up. Requires: + % @ # & ~`,
			`- /ta [answer] - Answer the current question.`,
			`- /trivia kick [username] - Disqualify a participant from the current trivia game. Requires: % @ # & ~`,
			`- /trivia leave - Makes the player leave the game.`,
			`- /trivia end - End a trivia game. Requires: + % @ # ~`,
			`Question modifying commands:`,
			`- /trivia submit [category] | [question] | [answer1], [answer2] ... [answern] - Adds question(s) to the submission database for staff to review. Requires: + % @ # & ~`,
			`- /trivia review - View the list of submitted questions. Requires: @ # & ~`,
			`- /trivia accept [index1], [index2], ... [indexn] OR all - Add questions from the submission database to the question database using their index numbers or ranges of them. Requires: @ # & ~`,
			`- /trivia reject [index1], [index2], ... [indexn] OR all - Remove questions from the submission database using their index numbers or ranges of them. Requires: @ # & ~`,
			`- /trivia add [category] | [question] | [answer1], [answer2], ... [answern] - Adds question(s) to the question database. Requires: % @ # & ~`,
			`- /trivia delete [question] - Delete a question from the trivia database. Requires: % @ # & ~`,
			`- /trivia qs - View the distribution of questions in the question database.`,
			`- /trivia qs [category] - View the questions in the specified category. Requires: % @ # & ~`,
			`- /trivia clearqs [category] - Clear all questions in the given category. Requires: # & ~`,
			`Informational commands:`,
			`- /trivia search [type], [query] - Searches for questions based on their type and their query. Valid types: submissions, subs, questions, qs. Requires: + % @ # & ~`,
			`- /trivia status [player] - lists the player's standings (your own if no player is specified) and the list of players in the current trivia game.`,
			`- /trivia rank [username] - View the rank of the specified user. If none is given, view your own.`,
			`- /trivia ladder - View information about the top 15 users on the trivia leaderboard.`,
			`- /trivia alltimeladder - View information about the top 15 users on the all time trivia leaderboard`,
		],
	},
};

process.nextTick(() => {
	Chat.multiLinePattern.register('/trivia add ', '/trivia submit ');
});
