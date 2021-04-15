/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { AllCardsService, allDuelsTreasureCardIds, CardClass } from '@firestone-hs/reference-data';
import { decode } from 'deckstrings';
import { MiniReview } from '../../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../../mr-lambda-common/models/reduce-output';
import { getConnection } from '../../mr-lambda-common/services/rds';
import { formatDate, http } from '../../mr-lambda-common/services/utils';
import { Implementation } from '../implementation';
import { loadMergedOutput } from './battlegrounds-implementation-common';

// Data retrieved from the DB, might be worth updating it from time to time
const cards = new AllCardsService();

const PLAYER_CLASSES = [
	CardClass[CardClass.DEMONHUNTER].toLowerCase(),
	CardClass[CardClass.DRUID].toLowerCase(),
	CardClass[CardClass.HUNTER].toLowerCase(),
	CardClass[CardClass.MAGE].toLowerCase(),
	CardClass[CardClass.PALADIN].toLowerCase(),
	CardClass[CardClass.PRIEST].toLowerCase(),
	CardClass[CardClass.ROGUE].toLowerCase(),
	CardClass[CardClass.SHAMAN].toLowerCase(),
	CardClass[CardClass.WARLOCK].toLowerCase(),
	CardClass[CardClass.WARRIOR].toLowerCase(),
];

export class AbstractDuelsTreasures implements Implementation<any> {
	constructor(protected readonly gameMode: 'duels' | 'paid-duels') {}

	public async loadReviewIds(query: string): Promise<readonly string[]> {
		const mysql = await getConnection();
		const lastJobQuery = `
			SELECT periodStart FROM duels_stats_treasure_winrate
			WHERE gameMode = '${this.gameMode}'
			ORDER BY periodStart DESC
			LIMIT 1
		`;
		console.log('running last job query', lastJobQuery);
		const lastJobData: readonly any[] = await mysql.query(lastJobQuery);
		console.log('lastJobData', lastJobData && lastJobData.length > 0 && lastJobData[0].periodStart);

		const startDate = lastJobData && lastJobData.length > 0 ? lastJobData[0].periodStart : null;
		const startDateStatemenet = startDate ? `AND creationDate >= '${formatDate(startDate)}' ` : '';

		// We get the data up to the end of the day prior to which the job runs
		const endDate = new Date();
		const formattedEndDate = formatDate(endDate);
		console.log('will be using dates', startDateStatemenet, formattedEndDate);

		const defaultQuery = `
			SELECT reviewId FROM replay_summary
			WHERE gameMode = '${this.gameMode}'
			AND playerCardId like 'PVPDR_Hero%'
			AND playerDecklist IS NOT NULL
			${startDateStatemenet}
			ORDER BY id DESC
		`;
		query = query || defaultQuery;
		console.log('running query', query);
		const dbResults: any[] = await mysql.query(query);
		console.log('got db results', dbResults.length, dbResults.length > 0 && dbResults[0]);
		const result: readonly string[] = dbResults.map(result => result.reviewId);
		console.log('filtered db results', result.length);
		return result;
	}

	public async extractMetric(replay: Replay, miniReview: MiniReview, replayXml: string): Promise<IntermediaryResult> {
		if (!replay) {
			console.warn('empty replay');
			return null;
		}

		const result: IntermediaryResult = await this.extractData(replay, miniReview, replayXml);
		console.log('result built');
		return result;
	}

	private async extractData(replay: Replay, miniReview: MiniReview, replayXml: string): Promise<IntermediaryResult> {
		await cards.initializeCardsDb();
		const deck = decode(miniReview.playerDecklist);
		const treasuresInDeck = deck.cards
			.map(cardInfo => Array(cardInfo[1]).fill(cardInfo[0]))
			.reduce((a, b) => a.concat(b), [])
			.map(cardDbfId => cards.getCardFromDbfId(cardDbfId))
			.filter(card => card)
			.filter(card => allDuelsTreasureCardIds.includes(card.id));

		const result: IntermediaryResult = {};
		// Init everything to not have to worry about empty structures later on
		for (const treasureId of allDuelsTreasureCardIds) {
			result[treasureId] = {} as IntermediaryResultForTreasure;
			for (const playerClass of PLAYER_CLASSES) {
				result[treasureId][playerClass] = {
					dataPoints: 0,
					totalWins: 0,
					totalLosses: 0,
					totalTies: 0,
				} as IntermediaryResultForTreasureAndClass;
			}
		}

		const playerClass = miniReview.playerClass;
		treasuresInDeck.forEach(treasure => {
			const treasureInfo: IntermediaryResultForTreasureAndClass = result[treasure.id][playerClass];
			const updatedInfo = {
				dataPoints: treasureInfo.dataPoints + 1,
				totalWins: miniReview.result === 'won' ? treasureInfo.totalWins + 1 : treasureInfo.totalWins,
				totalLosses: miniReview.result === 'lost' ? treasureInfo.totalLosses + 1 : treasureInfo.totalLosses,
				totalTies: miniReview.result === 'tied' ? treasureInfo.totalTies + 1 : treasureInfo.totalTies,
			} as IntermediaryResultForTreasureAndClass;
			result[treasure.id][playerClass] = updatedInfo;
		});
		return result;
	}

	public async mergeReduceEvents<IntermediaryResult>(
		inputResult: ReduceOutput<IntermediaryResult>,
		newResult: ReduceOutput<IntermediaryResult>,
	): Promise<ReduceOutput<IntermediaryResult>> {
		if (!inputResult || !inputResult.output) {
			console.log('inputResult is null');
			return newResult;
		}
		if (!newResult || !newResult.output) {
			console.log('newResult is null');
			return inputResult;
		}

		const currentResult = {
			output: inputResult.output || {},
		} as ReduceOutput<IntermediaryResult>;

		const output: IntermediaryResult = {} as IntermediaryResult;

		// console.log('will merge events', JSON.stringify(currentResult, null, 4), JSON.stringify(newResult, null, 4));
		console.log('will merge events');
		for (const treasureId of allDuelsTreasureCardIds) {
			// console.log('merging', playerCardId, currentResult.output[playerCardId], newResult.output[playerCardId]);
			output[treasureId] = this.mergeTreasures(
				currentResult.output[treasureId] || ({} as IntermediaryResultForTreasure),
				newResult.output[treasureId] || ({} as IntermediaryResultForTreasure),
			);
		}

		return {
			output: output,
		} as ReduceOutput<IntermediaryResult>;
	}

	private mergeTreasures(
		currentResult: IntermediaryResultForTreasure,
		newResult: IntermediaryResultForTreasure,
	): IntermediaryResultForTreasure {
		const output: IntermediaryResultForTreasure = {} as IntermediaryResultForTreasure;
		for (const playerClass of PLAYER_CLASSES) {
			output[playerClass] = this.mergeTreasuresForClass(
				currentResult[playerClass] || ({} as IntermediaryResultForTreasureAndClass),
				newResult[playerClass] || ({} as IntermediaryResultForTreasureAndClass),
			);
		}
		return output;
	}

	private mergeTreasuresForClass(
		currentOutput: IntermediaryResultForTreasureAndClass,
		newOutput: IntermediaryResultForTreasureAndClass,
	): IntermediaryResultForTreasureAndClass {
		return {
			dataPoints: (currentOutput.dataPoints || 0) + (newOutput.dataPoints || 0),
			totalWins: (currentOutput.totalWins || 0) + (newOutput.totalWins || 0),
			totalLosses: (currentOutput.totalLosses || 0) + (newOutput.totalLosses || 0),
			totalTies: (currentOutput.totalTies || 0) + (newOutput.totalTies || 0),
		};
	}

	public async transformOutput<IntermediaryResult>(
		output: ReduceOutput<IntermediaryResult>,
	): Promise<ReduceOutput<IntermediaryResult>> {
		console.log('transforming output', output);
		const mergedOutput: ReduceOutput<IntermediaryResult> = await loadMergedOutput(
			`${this.gameMode}-treasures`,
			output,
			(currentResult, newResult) => this.mergeReduceEvents(currentResult, newResult),
		);
		console.log('merged output', JSON.stringify(mergedOutput, null, 4));

		const endDate = new Date();
		const periodDate = formatDate(endDate);
		const stats = Object.keys(mergedOutput.output)
			.map(treasureId => {
				const treasure: IntermediaryResultForTreasure = mergedOutput.output[treasureId];
				return Object.keys(treasure).map(
					playerClass =>
						({
							periodStart: periodDate,
							cardId: treasureId,
							playerClass: playerClass,
							matchesPlayed: treasure[playerClass].dataPoints,
							totalLosses: treasure[playerClass].totalLosses,
							totalTies: treasure[playerClass].totalTies,
							totalWins: treasure[playerClass].totalWins,
						} as TreasureAndClassStatForDb),
				);
			})
			.reduce((a, b) => a.concat(b), []);

		const values = stats
			.map(
				stat =>
					`('${this.gameMode}', '${stat.periodStart}', '${stat.cardId}', '${stat.playerClass}', ${stat.matchesPlayed}, ${stat.totalLosses}, ${stat.totalTies}, ${stat.totalWins})`,
			)
			.join(',\n');
		const query = `
			INSERT INTO duels_stats_treasure_winrate
			(gameMode, periodStart, cardId, playerClass, matchesPlayed, totalLosses, totalTies, totalWins)
			VALUES ${values}
		`;
		console.log('running db insert query');
		const mysql = await getConnection();
		await mysql.query(query);

		return output;
	}
}

const getLastDuelsPatch = async (): Promise<number> => {
	const patchInfo = await http(`https://static.zerotoheroes.com/hearthstone/data/patches.json`);
	const structuredPatch = JSON.parse(patchInfo);
	return structuredPatch.currentDuelsMetaPatch;
};

interface IntermediaryResult {
	[treasureCardId: string]: IntermediaryResultForTreasure;
}

interface IntermediaryResultForTreasure {
	[playerClass: string]: IntermediaryResultForTreasureAndClass;
}

interface IntermediaryResultForTreasureAndClass {
	dataPoints: number;
	totalWins: number;
	totalLosses: number;
	totalTies: number;
}

interface TreasureAndClassStatForDb {
	periodStart: string;
	cardId: string;
	playerClass: string;
	matchesPlayed: number;
	totalWins: number;
	totalLosses: number;
	totalTies: number;
}
