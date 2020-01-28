/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser';
import { GameTag, Zone } from '@firestone-hs/reference-data';
import { encode } from 'deckstrings';
import { Element } from 'elementtree';
import { MiniReview } from '../../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../../mr-lambda-common/models/reduce-output';
import { AllCardsService } from '../../mr-lambda-common/services/cards';
import { getConnection } from '../../mr-lambda-common/services/rds';
import { Implementation } from '../implementation';

export class BuildAiDecklists implements Implementation {
	public async loadReviewIds(): Promise<readonly string[]> {
		const mysql = await getConnection();
		// Innkeeper normal
		const dbResults: any[] = await mysql.query(
			`
			SELECT reviewId
			FROM replay_summary
			WHERE scenarioId in (252, 256, 259, 263, 261, 258, 257, 262, 253)
		`,
		);
		const result = dbResults.map(result => result.reviewId);
		// console.log('loaded DB results', result.length);
		return result;
	}

	public async extractMetric(replay: Replay, miniReview: MiniReview): Promise<any> {
		if (!replay) {
			console.warn('empty replay', miniReview.id, miniReview.key);
			return null;
		}
		if ([252, 256, 259, 263, 261, 258, 257, 262, 253].indexOf(replay.scenarioId) === -1) {
			console.warn('invalid scenario id', replay.scenarioId);
			return null;
		}

		try {
			const opponentHeroEntityId = parseInt(
				replay.replay
					.findall(`.//Player`)
					.find(player => parseInt(player.get('playerID')) === replay.opponentPlayerId)
					.find(`Tag[@tag='${GameTag.HERO_ENTITY}']`)
					.get('value'),
			);
			const opponentCardId = replay.replay.find(`.//FullEntity[@id='${opponentHeroEntityId}']`).get('cardID');

			// All entities that are present in the deck at the start of the game
			// are created using a FullEntity at game start
			const idControllerMapping = {};
			for (const entity of replay.replay.findall('.//FullEntity')) {
				// Only consider cards that start in the deck
				if (parseInt(entity.find(`.Tag[@tag='${GameTag.ZONE}']`).get('value')) !== Zone.DECK) {
					continue;
				}
				const controllerId = parseInt(entity.find(`.Tag[@tag='${GameTag.CONTROLLER}']`).get('value'));
				if (idControllerMapping[this.getId(entity)]) {
					continue;
				}
				idControllerMapping[this.getId(entity)] = controllerId;
			}

			const entitiesWithCards = replay.replay
				.findall(`.//*[@cardID]`)
				.filter(
					entity =>
						!entity.find(`.Tag[@tag='${GameTag.CREATOR}']`) &&
						!entity.find(`.Tag[@tag='${GameTag.CREATOR_DBID}']`),
				);
			// Because cards can change controllers during the game, we need to only consider the
			// first time we see them
			const uniqueEntities = [];
			for (const entity of entitiesWithCards) {
				// Don't add duplicate entities
				if (uniqueEntities.map(entity => this.getId(entity)).indexOf(this.getId(entity)) !== -1) {
					continue;
				}
				// Only add cards
				uniqueEntities.push(entity);
			}

			const opponentEntities = uniqueEntities.filter(
				entity =>
					idControllerMapping[this.getId(entity)] &&
					idControllerMapping[this.getId(entity)] === replay.opponentPlayerId,
			);
			// console.log('entityElements', allEntities.length);
			const cardIdsInStartingDeck = opponentEntities.map(entity => entity.get('cardID'));
			// console.log('list of cards starting in opponents deck', cardIdsInStartingDeck);
			const grouped = cardIdsInStartingDeck.reduce((acc, val) => {
				acc[val] = (acc[val] || 0) + 1;
				if (acc[val] > 2) {
					console.warn('Suspicious deck', miniReview, acc, val);
				}
				if (['AT_018', 'HERO_04', 'EX1_043', 'EX1_016', 'LOE_077', 'BRM_028'].indexOf(val) !== -1) {
					console.warn('Suspicious deck', miniReview, acc, val);
				}
				return acc;
			}, {});
			// console.log('grouped', grouped);
			const output = [
				{
					opponentCardId: opponentCardId,
					scenarioId: replay.scenarioId,
					cards: grouped,
					numberOfGames: 1,
				} as Output,
			];
			// console.log('output', output);
			return output;
		} catch (e) {
			console.error('error while parsing', e, miniReview);
			return null;
		}
	}

	// public buildFullEntities(elements: Element[], playerId: number): Element[] {
	// 	return (
	// 		elements
	// 			// We're only interested in known cards
	// 			.filter(entity => entity.get('cardID'))
	// 			// Cards controlled by the opponent
	// 			.filter(entity => parseInt(entity.find(`.Tag[@tag='${GameTag.CONTROLLER}']`).get('value')) === playerId)
	// 			// Cards that started in the deck
	// 			.filter(
	// 				entity =>
	// 					!entity.find(`.Tag[@tag='${GameTag.CREATOR}']`) &&
	// 					!entity.find(`.Tag[@tag='${GameTag.CREATOR_DBID}']`),
	// 			)
	// 	);
	// }

	public async mergeReduceEvents(currentResult: ReduceOutput, newResult: ReduceOutput): Promise<ReduceOutput> {
		if (!currentResult) {
			return newResult;
		}
		if (!newResult) {
			return currentResult;
		}
		// console.log('merging reduce results', currentResult, newResult);
		const firstOutput: readonly Output[] = currentResult.output || [];
		const secondOutput: readonly Output[] = newResult.output || [];
		const result: Output[] = [];
		for (const firstInfo of firstOutput) {
			const secondInfo =
				secondOutput.find(
					info =>
						info.opponentCardId === firstInfo.opponentCardId && info.scenarioId === firstInfo.scenarioId,
				) || ({} as Output);
			const mergedInfo = this.mergeInfo(firstInfo, secondInfo);
			result.push(mergedInfo);
		}
		for (const secondInfo of secondOutput) {
			const firstInfo = firstOutput.find(
				info => info.opponentCardId === secondInfo.opponentCardId && info.scenarioId === secondInfo.scenarioId,
			);
			// If we find a match, we already did the merge in the first pass
			if (!firstInfo) {
				result.push(secondInfo);
			}
		}
		return {
			output: result,
		} as ReduceOutput;
	}

	private getId(entity: Element): number {
		return parseInt(entity.get('id') || entity.get('entity'));
	}

	private mergeInfo(firstInfo: Output, secondInfo: Output): Output {
		const firstDeck = firstInfo.cards || {};
		const secondDeck = secondInfo.cards || {};
		const cardsInFirstDeck = Object.keys(firstDeck);
		const cardsInSecondDeck = Object.keys(secondDeck);
		// console.log('cards in decks', cardsInFirstDeck, cardsInSecondDeck);
		const cards: { [cardId: string]: number } = {};
		for (const cardId of cardsInFirstDeck) {
			// console.log('assigning', cardId, firstDeck[cardId], secondDeck[cardId]);
			cards[cardId] = Math.max(firstDeck[cardId] || 0, secondDeck[cardId] || 0);
			// console.log('resulting', result[cardId]);
		}
		for (const cardId of cardsInSecondDeck) {
			// console.log('assigning 2', cardId, firstDeck[cardId], secondDeck[cardId]);
			cards[cardId] = Math.max(secondDeck[cardId] || 0, firstDeck[cardId] || 0);
			// console.log('resulting 2', result[cardId]);
		}
		// console.log('result', result);
		const result: Output = {
			opponentCardId: firstInfo.opponentCardId || secondInfo.opponentCardId,
			scenarioId: firstInfo.scenarioId || secondInfo.scenarioId,
			cards: cards,
			numberOfGames: (firstInfo.numberOfGames || 0) + (secondInfo.numberOfGames || 0),
		};
		return result;
	}

	public async transformOutput(output: ReduceOutput): Promise<ReduceOutput> {
		const cards = new AllCardsService();
		await cards.initializeCardsDb();
		// console.log('transforming output', output);
		return {
			output: this.transform(output.output, cards),
		} as ReduceOutput;
	}

	private transform(output: Output[], cards: AllCardsService): FinalOutput[] {
		return output.map(output => this.transformSingleOutput(output, cards));
	}

	private transformSingleOutput(output: Output, cards: AllCardsService): FinalOutput {
		const heroCard = cards.getCard(output.opponentCardId);
		const comment = `Innkeeper ${heroCard.name} deck (Normal) (${output.numberOfGames} games)`;
		const cardsForDeckstring = [];
		const cardNames = {};
		for (const cardId of Object.keys(output.cards)) {
			const dbCard = cards.getCard(cardId);
			cardsForDeckstring.push([dbCard.dbfId, output.cards[cardId]]);
			cardNames[dbCard.name] = output.cards[cardId];
		}
		const deckstring = encode({
			cards: cardsForDeckstring,
			heroes: [heroCard.dbfId],
			format: 1, // Don't care about that
		});
		return {
			comment: comment,
			opponentCardId: output.opponentCardId,
			scenarioIds: [output.scenarioId] as readonly number[],
			deckstring: deckstring,
			cards: output.cards,
			cardNames: cardNames,
		} as FinalOutput;
	}
}

interface Output {
	readonly opponentCardId: string;
	readonly scenarioId: number;
	readonly numberOfGames: number;
	readonly cards: { [cardId: string]: number };
}

interface FinalOutput {
	readonly comment: string;
	readonly opponentCardId: string;
	readonly scenarioIds: readonly number[];
	readonly numberOfGames: number;
	readonly deckstring: string;
	readonly cards: { [cardId: string]: number };
	readonly cardNames: { [cardName: string]: number };
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
