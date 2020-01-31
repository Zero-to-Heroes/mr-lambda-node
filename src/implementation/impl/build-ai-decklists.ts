/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser';
import { GameTag, Zone } from '@firestone-hs/reference-data';
import { encode } from 'deckstrings';
import { Element } from 'elementtree';
import { MiniReview } from '../../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../../mr-lambda-common/models/reduce-output';
import { AllCardsService } from '../../mr-lambda-common/services/cards';
import { getConnection } from '../../mr-lambda-common/services/rds';
import { ReferenceCard } from '../../mr-lambda-common/services/reference-card';
import { Implementation } from '../implementation';

export class BuildAiDecklists implements Implementation {
	private invalidCardsIds = [
		// The upgraded version of spellstones should never start in deck
		'LOOT_103t1',
		'LOOT_103t2',
		'LOOT_043t2',
		'LOOT_043t3',
		'LOOT_051t1',
		'LOOT_051t2',
		'LOOT_064t1',
		'LOOT_064t2',
		'LOOT_080t2',
		'LOOT_080t3',
		'LOOT_091t1',
		'LOOT_091t2',
		'LOOT_203t2',
		'LOOT_203t3',
		'LOOT_503t',
		'LOOT_503t2',
		'LOOT_507t',
		'LOOT_507t2',
		'FB_Champs_LOOT_080t2',
		'FB_Champs_LOOT_080t3',
	];
	public async loadReviewIds(): Promise<readonly string[]> {
		const mysql = await getConnection();
		// Innkeeper normal
		// const dbResults: any[] = await mysql.query(
		// 	`
		// 	SELECT reviewId
		// 	FROM replay_summary
		// 	WHERE scenarioId in (252, 256, 259, 263, 261, 258, 257, 262, 253)
		// `,
		// );
		// Innkeeper expert
		// const dbResults: any[] = await mysql.query(
		// 	`
		// 	SELECT reviewId
		// 	FROM replay_summary
		// 	WHERE scenarioId in (260, 264, 265, 266, 267, 268, 269, 270, 271)
		// `,
		// );
		// Galakrond's Awakening Normal
		// const dbResults: any[] = await mysql.query(
		// 	`
		// 	SELECT reviewId
		// 	FROM replay_summary
		// 	WHERE scenarioId in (3469, 3470, 3471, 3472, 3473, 3475, 3484, 3488, 3489, 3490, 3491, 3493)
		// `,
		// );
		// Galakrond's Awakening Heroic
		const dbResults: any[] = await mysql.query(
			`
			SELECT reviewId
			FROM replay_summary
			WHERE scenarioId in (3556, 3583, 3584, 3585, 3586, 3587, 3594, 3595, 3596, 3597, 3598, 3599)
		`,
		);
		// Tombs of Terror normal
		// const dbResults: any[] = await mysql.query(
		// 	`
		// 	SELECT reviewId
		// 	FROM replay_summary
		// 	WHERE scenarioId in (3428, 3429, 3430, 3431, 3432)
		// 	AND creationDate > '2019-10-01'
		// `,
		// );
		// Tombs of Terror heroic
		// const dbResults: any[] = await mysql.query(
		// 	`
		// 	SELECT reviewId
		// 	FROM replay_summary
		// 	WHERE scenarioId in (3433, 3434, 3435, 3436, 3437)
		// 	AND creationDate > '2019-10-01'
		// `,
		// );
		const result = dbResults.map(result => result.reviewId);
		// console.log('loaded DB results', result.length);
		return result;
	}

	public async extractMetric(replay: Replay, miniReview: MiniReview): Promise<any> {
		if (!replay) {
			console.warn('empty replay');
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
			// console.log('opponentHeroEntityId', opponentHeroEntityId, replay.opponentPlayerId);
			const opponentCardId = replay.replay.find(`.//FullEntity[@id='${opponentHeroEntityId}']`).get('cardID');
			// console.log('opponentCardId', opponentCardId);

			// All entities that are present in the deck at the start of the game
			// are created using a FullEntity at game start
			const idControllerMapping = {};
			for (const entity of replay.replay.findall('.//FullEntity')) {
				// Only consider cards that start in the deck
				if (
					parseInt(entity.find(`.Tag[@tag='${GameTag.ZONE}']`).get('value')) !== Zone.DECK &&
					// We need the entities that tell us a form change occurs. They will get filtered out from
					// the decklist later on
					!entity.find(`.Tag[@tag='${GameTag.HERO_DECK_ID}']`)
				) {
					continue;
				}
				const controllerId = parseInt(entity.find(`.Tag[@tag='${GameTag.CONTROLLER}']`).get('value'));
				if (idControllerMapping[this.getId(entity)]) {
					continue;
				}
				idControllerMapping[this.getId(entity)] = controllerId;
			}
			// console.log('idControllerMapping', idControllerMapping[685], Object.keys(idControllerMapping).length);

			const entitiesWithCards = replay.replay
				.findall(`.//*[@cardID]`)
				// Specific case for ToT, as it's the default value for the boss at the start of every game
				.filter(entity => entity.get('cardID') !== 'ULDA_BOSS_15h')
				.filter(entity => entity.find(`.Tag[@tag='${GameTag.HERO_DECK_ID}']`) || this.isEntityValid(entity))
				.filter(entity => this.invalidCardsIds.indexOf(entity.get('cardID')) === -1);
			// console.log(
			// 	'entitiesWithCards',
			// 	entitiesWithCards.map(entity => this.getId(entity)).length,
			// 	// replay.replay.findall(`.//*[@cardID]`).map(entity => this.getId(entity)),
			// );
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
			// console.log('uniqueEntities', uniqueEntities.map(entity => this.getId(entity)).length);

			const opponentEntities: Element[] = uniqueEntities.filter(
				entity =>
					idControllerMapping[this.getId(entity)] &&
					idControllerMapping[this.getId(entity)] === replay.opponentPlayerId,
			);
			// console.log('opponentEntities', opponentEntities.map(entity => this.getId(entity)).length);

			const splitEntities = {};
			let currentFormEntities: Element[] = [];
			// let cardIdsInStartingDeck: string[];
			// let grouped;
			let currentHeroDeckId = -1;
			let currentDeckIdEntity = -1;
			for (const entity of opponentEntities) {
				// Cards in hand are kept when changing form, and we don't want them to count
				// towards the cards in future forms. We kind of hack things here, as we assume
				// that entity ids are incremental (which they seem to be).
				// So any card created before the entity that changes the deck is to be ignore.
				// The exception is the very first deck change, as some of the cards in deck are
				// created before the change occurs
				if (this.getId(entity) < currentDeckIdEntity) {
					continue;
				}
				if (entity.find(`.Tag[@tag='${GameTag.HERO_DECK_ID}']`)) {
					// console.log(
					// 	'splitting entities',
					// 	entity.attrib,
					// 	currentFormEntities.length,
					// 	currentFormEntities.length > 0 && currentFormEntities[0].attrib,
					// );
					if (currentHeroDeckId !== -1 && currentFormEntities && currentFormEntities.length > 0) {
						// console.log('assigning deck', currentHeroDeckId, currentFormEntities.length);
						splitEntities[currentHeroDeckId] = this.group(
							currentFormEntities.map(entity => entity.get('cardID')),
							miniReview,
						);
						// if (!grouped) {
						// 	grouped = this.group(
						// 		currentFormEntities.map(entity => entity.get('cardID')),
						// 		miniReview,
						// 	);
						// 	console.log('assigning grouped', grouped, splitEntities[currentHeroDeckId]);
						// }
						currentFormEntities = [];
						currentDeckIdEntity = this.getId(entity);
					}
					currentHeroDeckId = parseInt(entity.find(`.Tag[@tag='${GameTag.HERO_DECK_ID}']`).get('value'));
					if (!this.isEntityValid(entity)) {
						continue;
					}
				}
				currentFormEntities.push(entity);
			}
			splitEntities[currentHeroDeckId] = this.group(
				currentFormEntities.map(entity => entity.get('cardID')),
				miniReview,
			);

			// If there is no "deck_entity_id" element, this will be the entry defined with -1 as key
			// const deckIds: readonly number[] = Object.keys(splitEntities).map(deckId => parseInt(deckId));
			// const initialList = splitEntities[Math.min(...deckIds)];
			// console.log('initialList', initialList.length, deckIds, Math.min(...deckIds));
			// console.log('initialList full', initialList);
			// console.log('splitEntities', splitEntities);
			// if (initialList['ULD_172'] && initialList['ULD_172'] === 3) {
			// 	console.log('Invalid decks', miniReview, initialList, replay.opponentPlayerId);
			// }
			// if (!Object.keys(initialList) || Object.keys(initialList).length === 0) {
			// 	console.log('Parsing issue', miniReview, initialList, replay.opponentPlayerId);
			// }
			// console.log('grouped', grouped);
			const output = [
				{
					opponentCardId: opponentCardId,
					scenarioIds: [replay.scenarioId],
					numberOfGames: 1,
					deckCards: splitEntities,
					deckTotalCardsSeen: splitEntities,
				} as Output,
			];
			console.log('output', output);
			return output;
		} catch (e) {
			console.error('error while parsing', e, miniReview);
			return null;
		}
	}

	public async mergeReduceEvents(currentResult: ReduceOutput, newResult: ReduceOutput): Promise<ReduceOutput> {
		if (!currentResult) {
			console.log('currentResult is null');
			return newResult;
		}
		if (!newResult) {
			console.log('newResult is null');
			return currentResult;
		}
		return {
			output: this.mergeOutputs(currentResult.output || [], newResult.output || []),
		} as ReduceOutput;
	}

	private mergeOutputs(firstOutput: readonly Output[], secondOutput: readonly Output[]): readonly Output[] {
		console.log('merging outputs', firstOutput, secondOutput);
		const result: Output[] = [];
		for (const firstInfo of firstOutput) {
			const secondInfo =
				secondOutput.find(info => info.opponentCardId === firstInfo.opponentCardId) || ({} as Output);
			const mergedInfo = this.mergeOutput(firstInfo, secondInfo);
			result.push(mergedInfo);
		}
		for (const secondInfo of secondOutput) {
			const firstInfo = firstOutput.find(info => info.opponentCardId === secondInfo.opponentCardId);
			// If we find a match, we already did the merge in the first pass
			if (!firstInfo) {
				result.push(secondInfo);
			}
		}
		console.log('result', result);
		return result;
	}

	private mergeOutput(firstInfo: Output, secondInfo: Output): Output {
		// console.log('merging output', firstInfo, secondInfo);
		const cardId = firstInfo.opponentCardId || secondInfo.opponentCardId;
		const scenarioIds = [...(firstInfo.scenarioIds || []), ...(secondInfo.scenarioIds || [])].filter(
			(value, index, self) => self.indexOf(value) === index,
		);
		const numberOfGames = (firstInfo.numberOfGames || 0) + (secondInfo.numberOfGames || 0);
		// const [cards, totalCardsSeen] = this.mergeCards(
		// 	firstInfo.cards || {},
		// 	secondInfo.cards || {},
		// 	firstInfo.totalCardsSeen || {},
		// 	secondInfo.totalCardsSeen || {},
		// );
		const allDeckKeys = [
			...Object.keys(firstInfo.deckCards || {}),
			...Object.keys(secondInfo.deckCards || {}),
		].filter((value, index, self) => self.indexOf(value) === index);
		const deckCards = {};
		const deckTotalCardsSeen = {};
		for (const deckId of allDeckKeys) {
			const [cards, totalCardsSeen] = this.mergeCards(
				(firstInfo.deckCards || {})[deckId] || {},
				(secondInfo.deckCards || {})[deckId] || {},
				(firstInfo.deckTotalCardsSeen || {})[deckId] || {},
				(secondInfo.deckTotalCardsSeen || {})[deckId] || {},
			);
			deckCards[deckId] = cards;
			deckTotalCardsSeen[deckId] = totalCardsSeen;
		}
		// console.log('ready to return', cardId, scenarioIds, numberOfGames, allDeckKeys);
		const result: Output = {
			opponentCardId: cardId,
			scenarioIds: scenarioIds,
			numberOfGames: numberOfGames,
			// cards: cards,
			// totalCardsSeen: totalCardsSeen,
			deckCards: deckCards,
			deckTotalCardsSeen: deckTotalCardsSeen,
		};
		// console.log('result', result);
		return result;
	}

	private mergeCards(
		firstDeck: { [cardId: string]: number },
		secondDeck: { [cardId: string]: number },
		firstSeen: { [cardId: string]: number },
		secondSeen: { [cardId: string]: number },
	): [{ [cardId: string]: number }, { [cardId: string]: number }] {
		const cardsInFirstDeck = Object.keys(firstDeck);
		const cardsInSecondDeck = Object.keys(secondDeck);
		// console.log('cards in decks', cardsInFirstDeck, cardsInSecondDeck);
		const cards: { [cardId: string]: number } = {};
		const totalCardsSeen: { [cardId: string]: number } = {};
		for (const cardId of cardsInFirstDeck) {
			// console.log('assigning', cardId, firstDeck[cardId], secondDeck[cardId]);
			cards[cardId] = Math.max(firstDeck[cardId] || 0, secondDeck[cardId] || 0);
			totalCardsSeen[cardId] = (firstSeen[cardId] || 0) + (secondSeen[cardId] || 0);
			// console.log('resulting', result[cardId]);
		}
		for (const cardId of cardsInSecondDeck) {
			// console.log('assigning 2', cardId, firstDeck[cardId], secondDeck[cardId]);
			cards[cardId] = Math.max(secondDeck[cardId] || 0, firstDeck[cardId] || 0);
			totalCardsSeen[cardId] = (secondSeen[cardId] || 0) + (firstSeen[cardId] || 0);
			// console.log('resulting 2', result[cardId]);
		}
		// console.log('result', [cards, totalCardsSeen]);
		return [cards, totalCardsSeen];
	}

	public async transformOutput(output: ReduceOutput): Promise<ReduceOutput> {
		const cards = new AllCardsService();
		await cards.initializeCardsDb();
		console.log(
			'transforming output',
			output.output.length,
			output.output.map(out => out.numberOfGames).reduce((a, b) => a + b, 0),
		);
		const result = this.transform(output.output, cards);
		console.log(
			'transformed',
			result.length,
			result.map(out => out.numberOfGames).reduce((a, b) => a + b, 0),
		);
		return {
			metadata: {
				numberOfDecks: result.length,
				numberOfGames: result.map(out => out.numberOfGames).reduce((a, b) => a + b, 0),
			},
			output: result,
		} as ReduceOutput;
	}

	private transform(output: Output[], cards: AllCardsService): FinalOutput[] {
		return output
			.filter(output => output.numberOfGames > 10)
			.map(output => this.transformSingleOutput(output, cards))
			.sort((a, b) => b.numberOfGames - a.numberOfGames);
	}

	private transformSingleOutput(output: Output, cardsService: AllCardsService): FinalOutput {
		const heroCard = cardsService.getCard(output.opponentCardId);
		const comment = `Galakrond ${heroCard.name} deck (Normal) (${output.numberOfGames} games)`;
		// const [totalCardsInDeck, deckstring, cardNames] = this.transformCards(cardsService, heroCard, output.cards);
		const decks = {};
		const deckTotalCardsInDeck = {};
		const deckCardNames = {};
		const deckCards = {};
		const deckTotalCardsSeen = {};
		for (const deckId of Object.keys(output.deckCards)) {
			// Remove the very weird stuff like cards being stolen by the AI
			// const maxAppearances = Math.max(...Object.values(output.deckTotalCardsSeen[deckId]));
			const thresholdAppearances = 10; //maxAppearances / 200;
			const unwantedCardIds = Object.keys(output.deckTotalCardsSeen[deckId]).filter(
				cardId => output.deckTotalCardsSeen[deckId][cardId] < thresholdAppearances,
			);
			for (const id of unwantedCardIds) {
				delete output.deckCards[deckId][id];
				delete output.deckTotalCardsSeen[deckId][id];
			}

			const [totalCardsInDeck, deckstring, cardNames] = this.transformCards(
				cardsService,
				heroCard,
				output.deckCards[deckId],
			);
			// Arbitrary number below which we consider a deck as invalid
			// To the best of my knowledge, no AI deck today has less than 7 cards (or even 10 for that matter)
			if (totalCardsInDeck < 7) {
				continue;
			}
			decks[deckId] = deckstring;
			deckTotalCardsInDeck[deckId] = totalCardsInDeck;
			deckCardNames[deckId] = cardNames;
			deckCards[deckId] = output.deckCards[deckId];
			deckTotalCardsSeen[deckId] = output.deckTotalCardsSeen[deckId];
		}
		const deckIds: readonly number[] = Object.keys(decks).map(deckId => parseInt(deckId));
		const mainDeckId = Math.min(...deckIds);
		const deckstring = decks[mainDeckId];
		const totalCardsInDeck = deckTotalCardsInDeck[mainDeckId];
		const initialList = output.deckCards[mainDeckId];
		const totalCardsSeen = output.deckTotalCardsSeen[mainDeckId];
		const cardNames = deckCardNames[mainDeckId];
		console.log('deckIds', deckIds, mainDeckId, initialList);
		return {
			comment: comment,
			numberOfGames: output.numberOfGames,
			opponentCardId: output.opponentCardId,
			scenarioIds: output.scenarioIds || [],
			deckstring: deckstring,
			totalCardsInDeck: totalCardsInDeck,
			cards: initialList,
			totalCardsSeen: totalCardsSeen,
			cardNames: cardNames,
			decks: decks,
			deckTotalCardsInDeck: deckTotalCardsInDeck,
			deckCards: deckCards,
			deckTotalCardsSeen: deckTotalCardsSeen,
			deckCardNames: deckCardNames,
		} as FinalOutput;
	}

	private transformCards(
		cardsService: AllCardsService,
		heroCard: ReferenceCard,
		cards: { [cardId: string]: number },
	): [number, string, { [cardName: string]: number }] {
		const cardsForDeckstring = [];
		const cardNames = {};
		for (const cardId of Object.keys(cards).sort()) {
			const dbCard = cardsService.getCard(cardId);
			cardsForDeckstring.push([dbCard.dbfId, cards[cardId]]);
			cardNames[dbCard.name] = cards[cardId];
		}
		const totalCardsInDeck = Object.values(cards).reduce((a, b) => a + b, 0);
		const deckstring = encode({
			cards: cardsForDeckstring,
			heroes: [heroCard.dbfId],
			format: 1, // Don't care about that
		});
		return [totalCardsInDeck, deckstring, cardNames];
	}

	private getId(entity: Element): number {
		return parseInt(entity.get('id') || entity.get('entity'));
	}

	private group(collection: string[], miniReview?: MiniReview) {
		return collection.reduce((acc, val) => {
			acc[val] = (acc[val] || 0) + 1;
			if (acc[val] > 2) {
				console.warn('Suspicious deck', miniReview, acc, val);
			}
			return acc;
		}, {});
	}

	private isEntityValid(entity: Element): boolean {
		return (
			(!entity.find(`.Tag[@tag='${GameTag.TOPDECK}']`) ||
				entity.find(`.Tag[@tag='${GameTag.TOPDECK}']`).get('value') === '0') &&
			(!entity.find(`.Tag[@tag='${GameTag.REVEALED}']`) ||
				entity.find(`.Tag[@tag='${GameTag.REVEALED}']`).get('value') === '0') &&
			(!entity.find(`.Tag[@tag='${GameTag.CREATOR}']`) ||
				entity.find(`.Tag[@tag='${GameTag.CREATOR}']`).get('value') === '0') &&
			(!entity.find(`.Tag[@tag='${GameTag.CREATOR_DBID}']`) ||
				entity.find(`.Tag[@tag='${GameTag.CREATOR_DBID}']`).get('value') === '0') &&
			(!entity.find(`.Tag[@tag='${GameTag.TRANSFORMED_FROM_CARD}']`) ||
				entity.find(`.Tag[@tag='${GameTag.TRANSFORMED_FROM_CARD}']`).get('value') === '0')
		);
	}
}

interface Output {
	readonly opponentCardId: string;
	readonly scenarioIds: readonly number[];
	readonly numberOfGames: number;
	readonly deckCards: { [deckId: string]: { [cardId: string]: number } };
	readonly deckTotalCardsSeen: { [deckId: string]: { [cardId: string]: number } };
}

interface FinalOutput {
	readonly comment: string;
	readonly opponentCardId: string;
	readonly scenarioIds: readonly number[];
	readonly numberOfGames: number;
	readonly deckstring: string;
	readonly totalCardsInDeck: number;
	readonly cards: { [cardId: string]: number };
	readonly totalCardsSeen: { [cardId: string]: number };
	readonly cardNames: { [cardName: string]: number };
	readonly decks: { [deckId: string]: string }; // The deckstrings for each deck
	readonly deckTotalCardsInDeck: { [deckId: string]: number };
	readonly deckCards: { [deckId: string]: { [cardId: string]: number } };
	readonly deckTotalCardsSeen: { [deckId: string]: { [cardId: string]: number } };
	readonly deckCardNames: { [deckId: string]: { [cardId: string]: number } };
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
