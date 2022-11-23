/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { GameTag } from '@firestone-hs/reference-data';
import { ReduceOutput } from '../../../mr-lambda-common/models/reduce-output';
import { getConnection } from '../../../mr-lambda-common/services/rds';
import { S3 } from '../../../mr-lambda-common/services/s3';
import { Implementation } from '../../implementation';

// const cards = new AllCardsService();
const s3 = new S3();

export class MercsPveTreasures implements Implementation<TreasureInfoOutput> {
	public async loadReviewIds(query: string): Promise<readonly string[]> {
		const mysql = await getConnection();

		const defaultQuery = `
			SELECT reviewId FROM replay_summary
			WHERE gameMode = 'mercenaries-pve'
			AND buildNumber >= 150659
			ORDER BY creationDate DESC
			LIMIT 10;
		`;
		query = query || defaultQuery;
		const dbResults: any[] = await mysql.query(query);
		const result = dbResults.map(result => result.reviewId);
		return result;
	}

	public async extractMetric(replay: Replay): Promise<any> {
		if (!replay) {
			console.warn('empty replay');
			return null;
		}

		const elementTree = replay.replay;
		// Also includes opponent, but not an issue
		const treasureCards = elementTree
			.findall(`.//FullEntity`)
			.filter(e => !!e.find(`.//Tag[@tag='${GameTag.LETTUCE_IS_TREASURE_CARD}'][@value='1']`));
		const output: TreasureInfoOutput = {
			cardIds: treasureCards.map(treasureElement => {
				const abilityOwner = treasureElement
					.find(`.//Tag[@tag='${GameTag.LETTUCE_ABILITY_OWNER}']`)
					.get('value');
				const ownerElement = elementTree.find(`.//FullEntity[@id='${abilityOwner}']`);
				const ownerCardId = ownerElement.get('cardID');
				return {
					cardId: treasureElement.get('cardID'),
					mercenaryCardIds: [normalizeMercenariesCardId(ownerCardId)],
					dataPoints: 1,
				};
			}),
		};
		return output;
	}

	// Not sure how to properly handle these generics in typecri
	public async mergeReduceEvents(
		currentResult: ReduceOutput<TreasureInfoOutput>,
		newResult: ReduceOutput<TreasureInfoOutput>,
	): Promise<ReduceOutput<TreasureInfoOutput>> {
		if (!currentResult?.output?.cardIds?.length) {
			return newResult;
		}
		if (!newResult?.output?.cardIds?.length) {
			return currentResult;
		}
		return {
			output: {
				cardIds: this.mergeTreasureInfo(currentResult.output.cardIds, newResult.output.cardIds),
			},
		};
	}

	private mergeTreasureInfo(
		firstOutput: readonly CardInfo[],
		secondOutput: readonly CardInfo[],
	): readonly CardInfo[] {
		const uniqueCardIds = [
			...new Set([...firstOutput.map(info => info.cardId), ...secondOutput.map(info => info.cardId)]),
		] as string[];
		return uniqueCardIds.map(cardId => {
			const firstInfo = firstOutput.find(info => info.cardId === cardId);
			const secondInfo = secondOutput.find(info => info.cardId === cardId);
			return {
				cardId: cardId,
				mercenaryCardIds: [
					...new Set([...(firstInfo?.mercenaryCardIds ?? []), ...(secondInfo?.mercenaryCardIds ?? [])]),
				],
				dataPoints: (firstInfo?.dataPoints || 0) + (secondInfo?.dataPoints || 0),
			};
		});
	}

	public async transformOutput(output: ReduceOutput<TreasureInfoOutput>): Promise<ReduceOutput<TreasureInfoOutput>> {
		// await cards.initializeCardsDb();
		const totalDataPoints = output.output.cardIds.reduce((acc, info) => acc + info.dataPoints, 0);
		const result: ReduceOutput<TreasureInfoOutput> = {
			output: {
				totalDataPoints: totalDataPoints,
				cardIds: output.output.cardIds
					.filter(info => info.dataPoints)
					.map(
						info =>
							({
								cardId: info.cardId,
								mercenaryCardIds: info.mercenaryCardIds,
								dataPoints: info.dataPoints,
								percentage: info.dataPoints / totalDataPoints,
							} as CardInfo),
					),
			},
		} as any;
		s3.writeFile(result.output.cardIds, 'com.zerotoheroes.mr', 'merc-pve-treasures.json');

		return result;
	}
}

interface TreasureInfoOutput {
	cardIds: readonly CardInfo[];
}

interface CardInfo {
	cardId: string;
	mercenaryCardIds: readonly string[];
	dataPoints: number;
}

const normalizeMercenariesCardId = (cardId: string): string => {
	if (!cardId?.length) {
		return null;
	}
	let skinMatch = cardId.match(/.*_(\d\d)([ab]?)$/);
	if (skinMatch) {
		return cardId.replace(/(.*)(_\d\d)([ab]?)$/, '$1_01$3');
	}
	// Sometimes it is 01, sometimes 001
	skinMatch = cardId.match(/.*_(\d\d\d)([ab]?)$/);
	if (skinMatch) {
		return cardId.replace(/(.*)(_\d\d\d)([ab]?)$/, '$1_001$3');
	}
	return cardId;
};
