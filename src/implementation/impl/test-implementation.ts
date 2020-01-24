/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser';
import { GameTag } from '@firestone-hs/reference-data';
import { MiniReview } from '../../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../../mr-lambda-common/models/reduce-output';
import { getConnection } from '../../mr-lambda-common/services/rds';
import { Implementation } from '../implementation';

export class TestImplementation implements Implementation {
	public async loadReviewIds(): Promise<readonly string[]> {
		const mysql = await getConnection();
		const dbResults: any[] = await mysql.query(
			`
			SELECT reviewId 
			FROM replay_summary 
			WHERE scenarioId = 252
			LIMIT 10
		`,
		);
		const result = dbResults.map(result => result.reviewId);
		console.log('loaded DB results', result.length);
		return result;
	}

	public async extractMetric(replay: Replay, miniReview: MiniReview): Promise<any> {
		const entityElements = [...replay.replay.findall(`.//FulllEntity`), ...replay.replay.findall(`.//ShowEntity`)];
		const cardIdsInStartingDeck = entityElements
			// We're only interested in known cards
			.filter(entity => entity.get('cardID'))
			// Cards controlled by the opponent
			.filter(
				entity =>
					parseInt(entity.find(`.Tag[@tag='${GameTag.CONTROLLER}']`).get('value')) ===
					replay.opponentPlayerId,
			)
			// Cards that started in the deck
			.filter(entity => !entity.find(`.Tag[@tag='${GameTag.CREATOR}']`))
			.map(entity => entity.get('cardID'));
		console.log('list of cards starting in opponents deck', cardIdsInStartingDeck);
		const grouped = cardIdsInStartingDeck.reduce((acc, val) => {
			acc[val] = (acc[val] || 0) + 1;
			return acc;
		}, {});
		console.log('grouped', grouped);
		return grouped;
	}

	public async mergeReduceEvents(currentResult: ReduceOutput, newResult: ReduceOutput): Promise<ReduceOutput> {
		// console.log('merging reduce results', currentResult, newResult);
		const firstDeck = currentResult.output || {};
		const secondDeck = newResult.output || {};
		const cardsInFirstDeck = Object.keys(firstDeck);
		const cardsInSecondDeck = Object.keys(secondDeck);
		// console.log('cards in decks', cardsInFirstDeck, cardsInSecondDeck);
		const result = {};
		for (const cardId of cardsInFirstDeck) {
			// console.log('assigning', cardId, firstDeck[cardId], secondDeck[cardId]);
			result[cardId] = Math.max(firstDeck[cardId] || 0, secondDeck[cardId] || 0);
			// console.log('resulting', result[cardId]);
		}
		for (const cardId of cardsInSecondDeck) {
			// console.log('assigning 2', cardId, firstDeck[cardId], secondDeck[cardId]);
			result[cardId] = Math.max(secondDeck[cardId] || 0, firstDeck[cardId] || 0);
			// console.log('resulting 2', result[cardId]);
		}
		// console.log('result', result);
		return {
			output: result,
		} as ReduceOutput;
	}
}

// const groupBy = (list, keyGetter): Map<string, number> => {
// 	const map = new Map();
// 	list.forEach(item => {
// 		const key = keyGetter(item);
// 		const collection = map.get(key);
// 		if (!collection) {
// 			map.set(key, [item]);
// 		} else {
// 			collection.push(item);
// 		}
// 	});
// 	return map;
// }
