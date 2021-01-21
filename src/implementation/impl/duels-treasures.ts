/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { AllCardsService, CardClass, CardIds } from '@firestone-hs/reference-data';
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

const TREASURES = [
	'PVPDR_SCH_Passive19',
	'PVPDR_SCH_Passive20',
	'PVPDR_SCH_Passive22',
	'PVPDR_SCH_Passive23',
	'PVPDR_SCH_Passive24',
	'PVPDR_SCH_Passive28',
	'PVPDR_SCH_Passive30',
	'PVPDR_SCH_Passive32',
	'PVPDR_SCH_Passive34',
	'PVPDR_DMF_Passive01',
	'PVPDR_DMF_Passive02',
	'DALA_702',
	'DALA_705',
	'DALA_711',
	'DALA_735',
	'DALA_736',
	'DALA_739',
	'DALA_744',
	'DALA_746',
	'FP1_006',
	'GILA_511',
	'GILA_801',
	'GILA_814',
	'GILA_824',
	'GILA_825',
	'GILA_913',
	'GILA_BOSS_35t',
	'LOEA_01',
	'LOOTA_803',
	'LOOTA_824',
	'LOOTA_825',
	'LOOTA_828',
	'LOOTA_840',
	'LOOTA_842b',
	'LOOTA_845',
	'LOOTA_846',
	'LOOT_998k',
	'NAX11_04',
	'NAX12_04',
	'NAX2_05H',
	'PVPDR_DMF_Passive01',
	'PVPDR_DMF_Passive02',
	'PVPDR_SCH_Active01',
	'PVPDR_SCH_Active02',
	'PVPDR_SCH_Active03',
	'PVPDR_SCH_Active05',
	'PVPDR_SCH_Active07',
	'PVPDR_SCH_Active08',
	'PVPDR_SCH_Active10',
	'PVPDR_SCH_Active11',
	'PVPDR_SCH_Active14',
	'PVPDR_SCH_Active17',
	'PVPDR_SCH_Active19',
	'PVPDR_SCH_Active20',
	'PVPDR_SCH_Active21',
	'PVPDR_SCH_Active23',
	'PVPDR_SCH_Active24',
	'PVPDR_SCH_Active26',
	'PVPDR_SCH_Active27',
	'PVPDR_SCH_Active28',
	'PVPDR_SCH_Active29',
	'PVPDR_SCH_Active30',
	'PVPDR_SCH_Active31',
	'PVPDR_SCH_Active34',
	'PVPDR_SCH_Active35',
	'PVPDR_SCH_Active38',
	'PVPDR_SCH_Active39',
	'PVPDR_SCH_Active42',
	'PVPDR_SCH_Active43',
	'PVPDR_SCH_Active44',
	'PVPDR_SCH_Active45',
	'PVPDR_SCH_Active46',
	'PVPDR_SCH_Active47',
	'PVPDR_SCH_Active48',
	'PVPDR_SCH_Active49',
	'PVPDR_SCH_Active50',
	'PVPDR_SCH_Active51',
	'PVPDR_SCH_Active52',
	'PVPDR_SCH_Active53',
	'PVPDR_SCH_Active54',
	'PVPDR_SCH_Active55',
	'PVPDR_SCH_Active56',
	'PVPDR_SCH_Active57',
	'PVPDR_SCH_Active58',
	'PVPDR_SCH_Active59',
	'PVPDR_SCH_Active60',
	'PVPDR_SCH_Active61',
	'PVPDR_SCH_Passive05',
	'PVPDR_SCH_Passive06',
	'PVPDR_SCH_Passive07',
	'PVPDR_SCH_Passive08',
	'PVPDR_SCH_Passive09',
	'PVPDR_SCH_Passive10',
	'PVPDR_SCH_Passive11',
	'PVPDR_SCH_Passive12',
	'PVPDR_SCH_Passive14',
	'PVPDR_SCH_Passive15a1',
	'PVPDR_SCH_Passive16',
	'PVPDR_SCH_Passive17',
	'PVPDR_SCH_Passive19',
	'PVPDR_SCH_Passive20',
	'PVPDR_SCH_Passive22',
	'PVPDR_SCH_Passive23',
	'PVPDR_SCH_Passive24',
	'PVPDR_SCH_Passive28',
	'PVPDR_SCH_Passive30',
	'PVPDR_SCH_Passive32',
	'PVPDR_SCH_Passive34',
	'SCH_224t',
	'ULDA_005',
	'ULDA_008',
	'ULDA_009',
	'ULDA_014',
	'ULDA_044',
	'ULDA_046',
	'ULDA_116',
	CardIds.NonCollectible.Neutral.AstralPortalTavernBrawl,
	CardIds.NonCollectible.Mage.MageArmorTavernBrawl,
	CardIds.NonCollectible.Neutral.AllShallServeTavernBrawl1,
	CardIds.NonCollectible.Neutral.DragonbloodTavernBrawl1,
	CardIds.NonCollectible.Neutral.StarvingTavernBrawl1,
	CardIds.NonCollectible.Neutral.TheFloorIsLavaTavernBrawl1,
];

export class AbstractDuelsTreasures implements Implementation {
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
			.filter(card => TREASURES.includes(card.id));

		const result: IntermediaryResult = {};
		// Init everything to not have to worry about empty structures later on
		for (const treasureId of TREASURES) {
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
		for (const treasureId of TREASURES) {
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
