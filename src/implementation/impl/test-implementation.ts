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
		const dbResults: readonly string[] = await mysql.query(
			`
			SELECT reviewId 
			FROM replay_summary 
			WHERE scenarioId = 252
		`,
		);
		console.log('loaded DB results', dbResults);
		return dbResults;
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
		const cardsInFirstDeck = Object.keys(currentResult.output);
		const cardsInSecondDeck = Object.keys(newResult.output);
		console.log('cards in decks', cardsInFirstDeck, cardsInSecondDeck);
		const result = {};
		for (const cardId of cardsInFirstDeck) {
			result[cardId] = Math.max(cardsInFirstDeck[cardId], cardsInSecondDeck[cardId] || 0);
		}
		for (const cardId of cardsInSecondDeck) {
			result[cardId] = Math.max(cardsInSecondDeck[cardId], cardsInFirstDeck[cardId] || 0);
		}
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
