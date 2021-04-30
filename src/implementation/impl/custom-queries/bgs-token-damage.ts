/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { CardIds, CardType, MetaTags, Zone } from '@firestone-hs/reference-data';
import { Element } from 'elementtree';
import { Map } from 'immutable';
import { MiniReview } from '../../../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../../../mr-lambda-common/models/reduce-output';
import { AllCardsService } from '../../../mr-lambda-common/services/cards';
import { getConnection } from '../../../mr-lambda-common/services/rds';
import { S3 } from '../../../mr-lambda-common/services/s3';
import { http } from '../../../mr-lambda-common/services/utils';
import { Implementation } from '../../implementation';
import { parseBgsGame, Parser, ParsingEntity, ParsingStructure } from './bgs-parser';

const cards = new AllCardsService();
const s3 = new S3();

export class BgsTokenDamage implements Implementation<TokenOutput> {
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
			const parser = new HeroAttackParser();
			parseBgsGame(replay, [parser]);
			const damagePerTurn: readonly DamageInfo[] = parser.entitiesThatDealHeroDamagePerTurn
				.keySeq()
				// .filter(turn => turn > 0)
				.map(turn => {
					const totalDamageFromTokensThisTurn = parser.entitiesThatDealHeroDamagePerTurn
						.get(turn)
						.map(cardId => cards.getCard(cardId)?.techLevel ?? 1)
						.reduce((a, b) => a + b, 0);
					return {
						turn: turn,
						totalTokenDamage: totalDamageFromTokensThisTurn,
						maxDamage: totalDamageFromTokensThisTurn,
						numberOfTokens: parser.entitiesThatDealHeroDamagePerTurn.get(turn).length,
						dataPoints: 1,
						damageDistribution: {
							[totalDamageFromTokensThisTurn]: 1,
						},
					};
				})
				.filter(info => info.numberOfTokens > 0 && info.totalTokenDamage > 0)
				.toArray();
			const damagePerCreator: readonly CreatorInfo[] = parser.creatorsThatDealHeroDamagePerCreator
				.keySeq()
				.map(creatorCardId => {
					const totalDamageFromTokens = parser.creatorsThatDealHeroDamagePerCreator
						.get(creatorCardId)
						.map(cardId => cards.getCard(cardId)?.techLevel ?? 1)
						.reduce((a, b) => a + b, 0);
					return {
						creatorCardId: creatorCardId,
						totalTokenDamage: totalDamageFromTokens,
						maxDamage: totalDamageFromTokens,
						numberOfTokens: parser.creatorsThatDealHeroDamagePerCreator.get(creatorCardId).length,
						dataPoints: 1,
						damageDistribution: {
							[totalDamageFromTokens]: 1,
						},
					};
				})
				.filter(info => info.numberOfTokens > 0 && info.totalTokenDamage > 0)
				.toArray();
			const output: TokenOutput = {
				tokenDamagePerTurn: damagePerTurn,
				damagePerCreator: damagePerCreator,
			};
			return output;
		} catch (e) {
			console.error('error while parsing', e, miniReview);
			return null;
		}
	}

	// Not sure how to properly handle these generics in typecri
	public async mergeReduceEvents(
		currentResult: ReduceOutput<TokenOutput>,
		newResult: ReduceOutput<TokenOutput>,
	): Promise<ReduceOutput<TokenOutput>> {
		if (!currentResult?.output?.tokenDamagePerTurn?.length) {
			return newResult;
		}
		if (!newResult?.output?.tokenDamagePerTurn?.length) {
			return currentResult;
		}
		return {
			output: {
				tokenDamagePerTurn: this.mergeDamagePerTurn(
					currentResult.output.tokenDamagePerTurn,
					newResult.output.tokenDamagePerTurn,
				),
				damagePerCreator: this.mergeDamagePerCreator(
					currentResult.output.damagePerCreator,
					newResult.output.damagePerCreator,
				),
			},
		};
	}

	private mergeDamagePerTurn(
		firstOutput: readonly DamageInfo[],
		secondOutput: readonly DamageInfo[],
	): readonly DamageInfo[] {
		const maxTurn = Math.max(...firstOutput.map(info => info.turn), ...secondOutput.map(info => info.turn));
		const result = [];
		for (let i = 1; i <= maxTurn; i++) {
			const firstInfo = firstOutput.find(info => info.turn === i);
			const secondInfo = secondOutput.find(info => info.turn === i);
			const damageDistribution = this.mergeDamageDistribution(
				firstInfo?.damageDistribution || {},
				secondInfo?.damageDistribution || {},
			);
			const totalDamageFromTokensThisTurn =
				(firstInfo?.totalTokenDamage || 0) + (secondInfo?.totalTokenDamage || 0);
			const totalNumberOfTokens = (firstInfo?.numberOfTokens || 0) + (secondInfo?.numberOfTokens || 0);
			result.push({
				turn: i,
				totalTokenDamage: totalDamageFromTokensThisTurn,
				maxDamage: Math.max(firstInfo?.maxDamage ?? 0, secondInfo?.maxDamage ?? 0),
				dataPoints: (firstInfo?.dataPoints ?? 0) + (secondInfo?.dataPoints ?? 0),
				numberOfTokens: totalNumberOfTokens,
				damageDistribution: damageDistribution,
			});
		}
		return result;
	}

	private mergeDamagePerCreator(
		firstOutput: readonly CreatorInfo[],
		secondOutput: readonly CreatorInfo[],
	): readonly CreatorInfo[] {
		const allCreators = [
			...firstOutput.map(info => info.creatorCardId),
			...secondOutput.map(info => info.creatorCardId),
		];
		const uniqueCreators: string[] = [...new Set(allCreators)] as string[];
		const result: CreatorInfo[] = [];
		for (const creator of uniqueCreators) {
			const firstInfo = firstOutput.find(info => info.creatorCardId === creator);
			const secondInfo = secondOutput.find(info => info.creatorCardId === creator);
			const totalDamageForCreator = (firstInfo?.totalTokenDamage || 0) + (secondInfo?.totalTokenDamage || 0);
			const damageDistribution = this.mergeDamageDistribution(
				firstInfo?.damageDistribution || {},
				secondInfo?.damageDistribution || {},
			);
			const totalNumberOfTokens = (firstInfo?.numberOfTokens || 0) + (secondInfo?.numberOfTokens || 0);
			result.push({
				creatorCardId: creator,
				totalTokenDamage: totalDamageForCreator,
				maxDamage: Math.max(firstInfo?.maxDamage ?? 0, secondInfo?.maxDamage ?? 0),
				dataPoints: (firstInfo?.dataPoints ?? 0) + (secondInfo?.dataPoints ?? 0),
				numberOfTokens: totalNumberOfTokens,
				damageDistribution: damageDistribution,
			});
		}
		return result;
	}

	private mergeDamageDistribution(
		first: { [damageAmount: number]: number },
		second: { [damageAmount: number]: number },
	): { [damageAmount: number]: number } {
		const result = {};
		const allAmounts = [...Object.keys(first), ...Object.keys(second)];
		const uniqueAmounts = [...new Set(allAmounts)];
		for (const amount of uniqueAmounts) {
			const firstAmount = first[amount] ?? 0;
			const secondAmount = second[amount] ?? 0;
			result[amount] = firstAmount + secondAmount;
		}
		return result;
	}

	public async transformOutput(output: ReduceOutput<TokenOutput>): Promise<ReduceOutput<TokenOutput>> {
		await cards.initializeCardsDb();
		const result: ReduceOutput<TokenOutput> = {
			output: {
				tokenDamagePerTurn: output.output.tokenDamagePerTurn
					.filter(info => info.dataPoints)
					.map(
						info =>
							({
								turn: info.turn,
								dataPoints: info.dataPoints,
								totalTokenDamage: info.totalTokenDamage,
								maxDamage: info.maxDamage,
								numberOfTokens: info.numberOfTokens,
								damageDistribution: info.damageDistribution,
								averageTokenDamage: info.totalTokenDamage / info.dataPoints,
								averageDamagePerToken: info.totalTokenDamage / info.numberOfTokens,
								// vs damage if token did 1 damage only
								excessDamage: (info.totalTokenDamage - info.numberOfTokens) / info.dataPoints,
							} as FinalDamageInfo),
					),
				damagePerCreator: output.output.damagePerCreator
					.filter(info => info.dataPoints && info.numberOfTokens)
					.map(
						info =>
							({
								creatorCardId: info.creatorCardId,
								dataPoints: info.dataPoints,
								totalTokenDamage: info.totalTokenDamage,
								maxDamage: info.maxDamage,
								numberOfTokens: info.numberOfTokens,
								damageDistribution: info.damageDistribution,
								averageTokenDamage: info.totalTokenDamage / info.dataPoints,
								averageDamagePerToken: info.totalTokenDamage / info.numberOfTokens,
								// vs damage if token did 1 damage only
								excessDamage: (info.totalTokenDamage - info.numberOfTokens) / info.dataPoints,
							} as FinalCreatorInfo),
					),
			},
		};

		const csvCreatorOutput = result.output.damagePerCreator
			.map((info: FinalCreatorInfo) => ({
				cardId: info.creatorCardId,
				cardName: cards.getCard(info.creatorCardId).name,
				dataPoints: info.dataPoints,
				averageDamage: info.averageTokenDamage,
				deltaFromTier: info.averageTokenDamage - (cards.getCard(info.creatorCardId).techLevel ?? 1),
				excessDamage: info.excessDamage,
				maxDamage: info.maxDamage,
				damageDistribution: this.buildDamageDistributionForCsv(info.damageDistribution),
			}))
			.map(
				info =>
					`${info.cardId}\t${info.cardName}\t${info.averageDamage}\t${info.deltaFromTier}\t${info.excessDamage}\t${info.maxDamage}\t${info.damageDistribution}`,
			)
			.join('\n');
		s3.writeFile(csvCreatorOutput, 'com.zerotoheroes.mr', 'bgs-token-damage-creator.csv');

		const csvTurnOutput = result.output.tokenDamagePerTurn
			.map((info: FinalDamageInfo) => ({
				turn: info.turn,
				dataPoints: info.dataPoints,
				averageDamage: info.averageTokenDamage,
				averageDamagePerToken: info.averageDamagePerToken,
				excessDamage: info.excessDamage,
				maxDamage: info.maxDamage,
			}))
			.map(
				info =>
					`${info.turn}\t${info.dataPoints}\t${info.averageDamage}\t${info.averageDamagePerToken}\t${info.excessDamage}\t${info.maxDamage}`,
			)
			.join('\n');
		s3.writeFile(csvTurnOutput, 'com.zerotoheroes.mr', 'bgs-token-damage-turn.csv');

		return result;
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

class HeroAttackParser implements Parser {
	entitiesThatDealHeroDamageThisTurn: readonly string[] = [];
	entitiesThatDealHeroDamagePerTurn: Map<number, readonly string[]> = Map.of();

	creatorsThatDealHeroDamageThisTurn: readonly CreatorDamage[] = [];
	creatorsThatDealHeroDamagePerCreator: Map<string, readonly string[]> = Map.of();

	parse = (structure: ParsingStructure) => {
		return (element: Element) => {
			if (element.tag === 'MetaData' && parseInt(element.get('meta')) === MetaTags.DAMAGE) {
				const infos = element.findall(`.Info`);
				const heroInfos = infos.filter(
					info => structure.entities[parseInt(info.get('entity'))]?.cardType === CardType.HERO,
				);
				if (!heroInfos || heroInfos.length === 0) {
					return;
				}

				// Now find out all the entities that are still on the board
				const entitiesInPlay = Object.values(structure.entities)
					.filter(entity => entity.zone === Zone.PLAY)
					.filter(entity => entity.cardType === CardType.MINION);
				const tokensThatDamage = entitiesInPlay
					.filter(entity => entity.creatorEntityId)
					.filter(
						entity =>
							structure.entities[entity.creatorEntityId].cardId !==
							CardIds.NonCollectible.Neutral.Baconshop8playerenchantTavernBrawl,
					)
					.filter(entity => entity.hasBeenReborn !== 1)
					.filter(entity => entity.summonedInCombat)
					.filter(
						entity =>
							structure.entities[entity.creatorEntityId].cardId !==
							CardIds.NonCollectible.Neutral.Baconshop8playerenchantTavernBrawl,
					);
				this.entitiesThatDealHeroDamageThisTurn = tokensThatDamage.map(entity => entity.cardId);
				this.creatorsThatDealHeroDamageThisTurn = tokensThatDamage
					.map(entity => ({
						// TODO: find a ghstcoiler game to test
						creatorCardId: this.getCreatorCardId(entity, structure),
						cards: [entity.cardId],
					}))
					.filter(
						info =>
							info.creatorCardId &&
							info.creatorCardId !== CardIds.NonCollectible.Neutral.Baconshop8playerenchantTavernBrawl,
					);
				// .map(entity => ({
				// 	id: entity.entityId,
				// 	cardId: entity.cardId,
				// 	creatorEntityId: entity.creator,
				// }));
				console.debug('this.entitiesThatDealHeroDamageThisTurn', this.entitiesThatDealHeroDamageThisTurn);
			}
		};
	};

	populate = (structure: ParsingStructure) => {
		return currentTurn => {
			this.entitiesThatDealHeroDamagePerTurn = this.entitiesThatDealHeroDamagePerTurn.set(
				currentTurn,
				this.entitiesThatDealHeroDamageThisTurn,
			);
			this.entitiesThatDealHeroDamageThisTurn = [];

			for (const creatorInfo of this.creatorsThatDealHeroDamageThisTurn) {
				this.creatorsThatDealHeroDamagePerCreator = this.creatorsThatDealHeroDamagePerCreator.set(
					creatorInfo.creatorCardId,
					[
						...this.creatorsThatDealHeroDamagePerCreator.get(creatorInfo.creatorCardId, []),
						...creatorInfo.cards,
					],
				);
			}
			this.creatorsThatDealHeroDamageThisTurn = [];
		};
	};

	private isValidCreator(entity: ParsingEntity, structure: ParsingStructure): boolean {
		return !entity.summonedInCombat;
	}

	private getCreatorCardId(entity: ParsingEntity, structure: ParsingStructure): string {
		let creatorEntity = structure.entities[entity.creatorEntityId];
		while (!this.isValidCreator(creatorEntity, structure)) {
			creatorEntity = structure.entities[creatorEntity.creatorEntityId];
		}
		return creatorEntity.cardId;
	}
}

interface CreatorDamage {
	creatorCardId: string;
	cards: readonly string[];
}

interface TokenOutput {
	tokenDamagePerTurn: readonly DamageInfo[];
	damagePerCreator: readonly CreatorInfo[];
}

interface DamageInfo {
	turn: number;
	totalTokenDamage: number;
	maxDamage: number;
	numberOfTokens: number;
	dataPoints: number;
	damageDistribution: { [damageAmount: string]: number };
}

interface CreatorInfo {
	creatorCardId: string;
	totalTokenDamage: number;
	maxDamage: number;
	numberOfTokens: number;
	dataPoints: number;
	damageDistribution: { [damageAmount: number]: number };
}

interface FinalDamageInfo extends DamageInfo {
	averageTokenDamage: number;
	averageDamagePerToken: number;
	excessDamage: number;
}

interface FinalCreatorInfo extends CreatorInfo {
	averageTokenDamage: number;
	averageDamagePerToken: number;
	excessDamage: number;
}
