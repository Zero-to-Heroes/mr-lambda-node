/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { BlockType, CardIds, GameTag } from '@firestone-hs/reference-data';
import { Element } from 'elementtree';
import { MiniReview } from '../../../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../../../mr-lambda-common/models/reduce-output';
import { AllCardsService } from '../../../mr-lambda-common/services/cards';
import { getConnection } from '../../../mr-lambda-common/services/rds';
import { S3 } from '../../../mr-lambda-common/services/s3';
import { groupByFunction, http } from '../../../mr-lambda-common/services/utils';
import { Implementation } from '../../implementation';
import { parseBgsGame, Parser, ParsingStructure } from './bgs-parser';

const cards = new AllCardsService();
const s3 = new S3();

export class BgsTotalBuff implements Implementation<BuffOutput> {
	public async loadReviewIds(query: string): Promise<readonly string[]> {
		const lastBattlegroundsPatch = await getLastBattlegroundsPatch();
		const mysql = await getConnection();

		const defaultQuery = `
			SELECT reviewId FROM replay_summary
			WHERE gameMode = 'battlegrounds'
			AND buildNumber >= ${lastBattlegroundsPatch}
			ORDER BY creationDate DESC
			LIMIT 2
		`;
		query = query || defaultQuery;
		const dbResults: any[] = await mysql.query(query);
		const result = dbResults.map(result => result.reviewId);
		return result;
	}

	public async extractMetric(replay: Replay, miniReview: MiniReview): Promise<any> {
		if (!replay) {
			console.warn('empty replay');
			return null;
		}

		// TODO: only keep the turns where some tokens actually do some damage?
		try {
			await cards.initializeCardsDb();
			const parser = new EntityBuffParser();
			parseBgsGame(replay, [parser]);
			const buffInfos: readonly BuffInfo[] = Object.keys(parser.buffsByTurn)
				.map(turn => {
					const buffsForTurn = parser.buffsByTurn[parseInt(turn)];
					return buffsForTurn.map(
						buff =>
							({
								turn: parseInt(turn),
								cardId: buff.cardId,
								totalBuff: buff.buffValue,
								dataPoints: 1,
							} as BuffInfo),
					);
				})
				.reduce((a, b) => a.concat(b), [])
				.filter(buff => buff.totalBuff > 0);

			// if (!buffInfos.map(buff => buff.totalBuff).reduce((a, b) => a + b, 0)) {
			// 	return null;
			// }
			const output: BuffOutput = {
				buffPerCreatorPerTurn: buffInfos,
			};
			return output;
		} catch (e) {
			console.error('error while parsing', e, miniReview);
			return null;
		}
	}

	// Not sure how to properly handle these generics in typecri
	public async mergeReduceEvents(
		currentResult: ReduceOutput<BuffOutput>,
		newResult: ReduceOutput<BuffOutput>,
	): Promise<ReduceOutput<BuffOutput>> {
		if (!currentResult?.output?.buffPerCreatorPerTurn?.length) {
			return newResult;
		}
		if (!newResult?.output?.buffPerCreatorPerTurn?.length) {
			return currentResult;
		}
		return {
			output: {
				buffPerCreatorPerTurn: this.mergeBuffs(
					currentResult.output.buffPerCreatorPerTurn,
					newResult.output.buffPerCreatorPerTurn,
				),
			},
		};
	}

	private mergeBuffs(firstOutput: readonly BuffInfo[], secondOutput: readonly BuffInfo[]): readonly BuffInfo[] {
		const maxTurn = Math.max(...firstOutput.map(info => info.turn), ...secondOutput.map(info => info.turn));
		const result: BuffInfo[] = [];
		for (let i = 1; i <= maxTurn; i++) {
			const firstInfos = firstOutput.filter(info => info.turn === i);
			const secondInfos = secondOutput.filter(info => info.turn === i);
			const mergedInfos = this.mergeBuffsForTurn(i, firstInfos, secondInfos);
			result.push(...mergedInfos);
		}
		return result;
	}

	mergeBuffsForTurn(
		turn: number,
		firstInfos: readonly BuffInfo[],
		secondInfos: readonly BuffInfo[],
	): readonly BuffInfo[] {
		const allCardsIds: readonly string[] = [
			...firstInfos.map(info => info.cardId),
			...secondInfos.map(info => info.cardId),
		];
		const uniqueCardIds = [...new Set(allCardsIds)];
		return uniqueCardIds.map(cardId => {
			const infosForCard = [
				...firstInfos.filter(info => info.cardId === cardId),
				...secondInfos.filter(info => info.cardId === cardId),
			];
			return {
				cardId: cardId,
				turn: turn,
				dataPoints: infosForCard.map(info => info.dataPoints ?? 0).reduce((a, b) => a + b, 0),
				totalBuff: infosForCard.map(info => info.totalBuff ?? 0).reduce((a, b) => a + b, 0),
			};
		});
	}

	public async transformOutput(output: ReduceOutput<BuffOutput>): Promise<ReduceOutput<BuffOutput>> {
		await cards.initializeCardsDb();

		// s3.writeFile(csvCreatorOutput, 'com.zerotoheroes.mr', 'bgs-token-damage-creator.csv');

		// const csvTurnOutput = result.output.tokenDamagePerTurn
		// 	.map((info: FinalDamageInfo) => ({
		// 		turn: info.turn,
		// 		dataPoints: info.dataPoints,
		// 		averageDamage: info.averageTokenDamage,
		// 		averageDamagePerToken: info.averageDamagePerToken,
		// 		excessDamage: info.excessDamage,
		// 		maxDamage: info.maxDamage,
		// 	}))
		// 	.map(
		// 		info =>
		// 			`${info.turn}\t${info.dataPoints}\t${info.averageDamage}\t${info.averageDamagePerToken}\t${info.excessDamage}\t${info.maxDamage}`,
		// 	)
		// 	.join('\n');
		// s3.writeFile(csvTurnOutput, 'com.zerotoheroes.mr', 'bgs-token-damage-turn.csv');

		// return result;
		return output;
	}

	private buildDamageDistributionForCsv(damageDistribution: { [damageAmount: number]: number }): string {
		const result = [];
		for (let i = 0; i < 42; i++) {
			result.push(damageDistribution[i] ?? 0);
		}
		return result.join('|');
	}
}

export const getLastBattlegroundsPatch = async (): Promise<number> => {
	const patchInfo = await http(`https://static.zerotoheroes.com/hearthstone/data/patches.json`);
	const structuredPatch = JSON.parse(patchInfo);
	return structuredPatch.currentBattlegroundsMetaPatch;
};

// Change of scope: lightfang vs lil'rag vs Nomi
// Keep only the games where at least one buff of any of them applied
class EntityBuffParser implements Parser {
	private validBuffers = [
		CardIds.NonCollectible.Neutral.LightfangEnforcer,
		CardIds.NonCollectible.Neutral.LightfangEnforcerBattlegrounds,
		CardIds.NonCollectible.Neutral.LilRag,
		CardIds.NonCollectible.Neutral.LilRagBattlegrounds,
		// CardIds.NonCollectible.Neutral.NomiKitchenNightmare,
		// CardIds.NonCollectible.Neutral.NomiKitchenNightmareBattlegrounds,
	];

	buffsForThisTurn: readonly BuffApplied[] = [];
	buffsByTurn: { [turnNumber: number]: readonly BuffApplied[] } = {};

	parse = (structure: ParsingStructure) => {
		return (element: Element) => {
			// Can also be a play block, when the buff is a battlecry
			if (element.tag !== 'Block' || parseInt(element.get('type')) !== BlockType.TRIGGER) {
				return;
			}

			const buffingCardId = structure.entities[parseInt(element.get('entity'))]?.cardId;
			if (!this.validBuffers.includes(buffingCardId)) {
				return;
			}

			// For now only handle summons while in tavern
			if (structure.entities[structure.gameEntityId].boardVisualState === 2) {
				return;
			}

			const attackChanges = element.findall(`TagChange[@tag='${GameTag.ATK}']`);
			const attackBuff = attackChanges
				.map(change => {
					const buffedEntity = structure.entities[parseInt(change.get('entity'))];
					const previousAttack = buffedEntity.atk;
					const buff = parseInt(change.get('value')) - previousAttack;
					return buff;
				})
				.reduce((a, b) => a + b, 0);
			const bufferCardId = structure.entities[parseInt(element.get('entity'))].cardId;
			this.buffsForThisTurn = [
				...this.buffsForThisTurn,
				{
					cardId: bufferCardId,
					buffValue: 2 * attackBuff,
				} as BuffApplied,
			];
		};
	};

	populate = (structure: ParsingStructure) => {
		return (currentTurn: number) => {
			if (currentTurn) {
				const groupedByEnchantments: { [cardId: string]: readonly BuffApplied[] } = groupByFunction(
					(buff: BuffApplied) => buff.cardId,
				)(this.buffsForThisTurn);
				// console.debug('echantments this turn', this.enchantmentsAppliedThisTurn);
				const enchantmentsForTurn: readonly BuffApplied[] = Object.keys(groupedByEnchantments).map(cardId => {
					const buffsForCard = groupedByEnchantments[cardId];
					const totalBuffValue = buffsForCard.map(buff => buff.buffValue).reduce((a, b) => a + b, 0);
					if (
						[
							CardIds.NonCollectible.Neutral.LightfangEnforcer,
							CardIds.NonCollectible.Neutral.LightfangEnforcerBattlegrounds,
						].includes(cardId) &&
						totalBuffValue % 4 !== 0
					) {
						console.error('incorrect buff value', cardId, totalBuffValue, buffsForCard);
					}
					return {
						cardId: cardId,
						buffValue: totalBuffValue,
					};
				});
				// console.debug('applied on turn ', currentTurn, enchantmentsForTurn);
				this.buffsByTurn[currentTurn] = enchantmentsForTurn;
			}
			this.buffsForThisTurn = [];
		};
	};
}

interface BuffApplied {
	cardId: string;
	buffValue: number;
}

interface BuffOutput {
	buffPerCreatorPerTurn: readonly BuffInfo[];
}

interface BuffInfo {
	turn: number;
	cardId: string;
	totalBuff: number;
	dataPoints: number;
}
