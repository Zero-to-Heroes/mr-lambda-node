/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { AllCardsService, allDuelsHeroes, allDuelsTreasureCardIds, CardClass, CardIds } from '@firestone-hs/reference-data';
import { decode } from 'deckstrings';
import { MiniReview } from '../../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../../mr-lambda-common/models/reduce-output';
import { getConnection } from '../../mr-lambda-common/services/rds';
import { formatDate, http } from '../../mr-lambda-common/services/utils';
import { Implementation } from '../implementation';
import { loadMergedOutput } from './battlegrounds-implementation-common';

// Data retrieved from the DB, might be worth updating it from time to time
const cards = new AllCardsService();

// const PLAYER_CLASSES = [
// 	CardClass[CardClass.DEMONHUNTER].toLowerCase(),
// 	CardClass[CardClass.DRUID].toLowerCase(),
// 	CardClass[CardClass.HUNTER].toLowerCase(),
// 	CardClass[CardClass.MAGE].toLowerCase(),
// 	CardClass[CardClass.PALADIN].toLowerCase(),
// 	CardClass[CardClass.PRIEST].toLowerCase(),
// 	CardClass[CardClass.ROGUE].toLowerCase(),
// 	CardClass[CardClass.SHAMAN].toLowerCase(),
// 	CardClass[CardClass.WARLOCK].toLowerCase(),
// 	CardClass[CardClass.WARRIOR].toLowerCase(),
// ];

/** @deprecated this is not used anymore */
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
		const lastJobData: readonly any[] = await mysql.query(lastJobQuery);

		const startDate = lastJobData && lastJobData.length > 0 ? lastJobData[0].periodStart : null;
		const startDateStatemenet = startDate ? `AND creationDate >= '${formatDate(startDate)}' ` : '';

		// We get the data up to the end of the day prior to which the job runs
		const endDate = new Date();
		const formattedEndDate = formatDate(endDate);

		const defaultQuery = `
			SELECT reviewId FROM replay_summary
			WHERE gameMode = '${this.gameMode}'
			AND playerCardId like 'PVPDR_Hero%'
			AND playerDecklist IS NOT NULL
			${startDateStatemenet}
			ORDER BY id DESC
		`;
		query = query || defaultQuery;
		const dbResults: any[] = await mysql.query(query);
		const result: readonly string[] = dbResults.map(result => result.reviewId);
		return result;
	}

	public async extractMetric(replay: Replay, miniReview: MiniReview, replayXml: string): Promise<IntermediaryResult> {
		if (!replay) {
			console.warn('empty replay');
			return null;
		}

		const result: IntermediaryResult = await this.extractData(replay, miniReview, replayXml);
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
			.filter(card => allDuelsTreasureCardIds.includes(card.id as CardIds));

		const result: IntermediaryResult = {};
		// Init everything to not have to worry about empty structures later on
		for (const treasureId of allDuelsTreasureCardIds) {
			result[treasureId] = {} as IntermediaryResultForTreasure;
			for (const hero of allDuelsHeroes) {
				result[treasureId][hero] = {
					dataPoints: 0,
					totalWins: 0,
					totalLosses: 0,
					totalTies: 0,
				} as IntermediaryResultForTreasureAndClass;
			}
		}

		const playerHero = miniReview.playerCardId;
		treasuresInDeck.forEach(treasure => {
			const treasureInfo: IntermediaryResultForTreasureAndClass = result[treasure.id][playerHero];
			const updatedInfo = {
				dataPoints: treasureInfo.dataPoints + 1,
				totalWins: miniReview.result === 'won' ? treasureInfo.totalWins + 1 : treasureInfo.totalWins,
				totalLosses: miniReview.result === 'lost' ? treasureInfo.totalLosses + 1 : treasureInfo.totalLosses,
				totalTies: miniReview.result === 'tied' ? treasureInfo.totalTies + 1 : treasureInfo.totalTies,
			} as IntermediaryResultForTreasureAndClass;
			result[treasure.id][playerHero] = updatedInfo;
		});
		return result;
	}

	public async mergeReduceEvents<IntermediaryResult>(
		inputResult: ReduceOutput<IntermediaryResult>,
		newResult: ReduceOutput<IntermediaryResult>,
	): Promise<ReduceOutput<IntermediaryResult>> {
		if (!inputResult || !inputResult.output) {
			return newResult;
		}
		if (!newResult || !newResult.output) {
			return inputResult;
		}

		const currentResult = {
			output: inputResult.output || {},
		} as ReduceOutput<IntermediaryResult>;

		const output: IntermediaryResult = {} as IntermediaryResult;

		for (const treasureId of allDuelsTreasureCardIds) {
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
		for (const hero of allDuelsHeroes) {
			output[hero] = this.mergeTreasuresForClass(
				currentResult[hero] || ({} as IntermediaryResultForTreasureAndClass),
				newResult[hero] || ({} as IntermediaryResultForTreasureAndClass),
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
		const mergedOutput: ReduceOutput<IntermediaryResult> = await loadMergedOutput(
			`${this.gameMode}-treasures`,
			output,
			(currentResult, newResult) => this.mergeReduceEvents(currentResult, newResult),
		);

		const endDate = new Date();
		const periodDate = formatDate(endDate);
		const stats = Object.keys(mergedOutput.output)
			.map(treasureId => {
				const treasure: IntermediaryResultForTreasure = mergedOutput.output[treasureId];
				return Object.keys(treasure).map(
					hero =>
						({
							periodStart: periodDate,
							cardId: treasureId,
							playerClass: hero,
							matchesPlayed: treasure[hero].dataPoints,
							totalLosses: treasure[hero].totalLosses,
							totalTies: treasure[hero].totalTies,
							totalWins: treasure[hero].totalWins,
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
