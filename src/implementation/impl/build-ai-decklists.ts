/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { CardType, GameTag, getBaseCardId, Zone } from '@firestone-hs/reference-data';
import { encode } from 'deckstrings';
import { Element } from 'elementtree';
import { MiniReview } from '../../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../../mr-lambda-common/models/reduce-output';
import { AllCardsService } from '../../mr-lambda-common/services/cards';
import { getConnection } from '../../mr-lambda-common/services/rds';
import { ReferenceCard } from '../../mr-lambda-common/services/reference-card';
import { Implementation } from '../implementation';

export class BuildAiDecklists implements Implementation {
	// private mappedCardIds = [
	// 	// The upgraded version of spellstones should never start in deck
	// 	['LOOT_103t1', 'LOOT_103'],
	// 	['LOOT_103t2', 'LOOT_103'],
	// 	['LOOT_043t2', 'LOOT_043'],
	// 	['LOOT_043t3', 'LOOT_043'],
	// 	['LOOT_051t1', 'LOOT_051'],
	// 	['LOOT_051t2', 'LOOT_051'],
	// 	['LOOT_064t1', 'LOOT_064'],
	// 	['LOOT_064t2', 'LOOT_064'],
	// 	['LOOT_080t2', 'LOOT_080'],
	// 	['LOOT_080t3', 'LOOT_080'],
	// 	['LOOT_091t1', 'LOOT_091'],
	// 	['LOOT_091t2', 'LOOT_091'],
	// 	['LOOT_203t2', 'LOOT_203'],
	// 	['LOOT_203t3', 'LOOT_203'],
	// 	['LOOT_503t', 'LOOT_503'],
	// 	['LOOT_503t2', 'LOOT_503'],
	// 	['LOOT_507t', 'LOOT_507'],
	// 	['LOOT_507t2', 'LOOT_507'],
	// 	['FB_Champs_LOOT_080t2', 'FB_Champs_LOOT_080'],
	// 	['FB_Champs_LOOT_080t3', 'FB_Champs_LOOT_080'],
	// 	// The "unidentified" spells
	// 	['LOOT_278t1', 'LOOT_278'],
	// 	['LOOT_278t2', 'LOOT_278'],
	// 	['LOOT_278t3', 'LOOT_278'],
	// 	['LOOT_278t4', 'LOOT_278'],
	// 	['LOOT_285t', 'LOOT_285'],
	// 	['LOOT_285t2', 'LOOT_285'],
	// 	['LOOT_285t3', 'LOOT_285'],
	// 	['LOOT_285t4', 'LOOT_285'],
	// 	['LOOT_286t1', 'LOOT_286'],
	// 	['LOOT_286t2', 'LOOT_286'],
	// 	['LOOT_286t3', 'LOOT_286'],
	// 	['LOOT_286t4', 'LOOT_286'],
	// 	['DAL_366t1', 'DAL_366'],
	// 	['DAL_366t2', 'DAL_366'],
	// 	['DAL_366t3', 'DAL_366'],
	// 	['DAL_366t4', 'DAL_366'],
	// 	// Galakrond
	// 	['DRG_600t2', 'DRG_600'],
	// 	['DRG_600t3', 'DRG_600'],
	// 	['DRG_610t2', 'DRG_610'],
	// 	['DRG_610t3', 'DRG_610'],
	// 	['DRG_620t2', 'DRG_620'],
	// 	['DRG_620t3', 'DRG_620'],
	// 	['DRG_650t2', 'DRG_650'],
	// 	['DRG_650t3', 'DRG_650'],
	// 	['DRG_660t2', 'DRG_660'],
	// 	['DRG_660t3', 'DRG_660'],
	// 	// Corrupted
	// 	['DMF_054t', 'DMF_054'],
	// 	['DMF_061t', 'DMF_061'],
	// 	['DMF_064t', 'DMF_064'],
	// 	['DMF_073t', 'DMF_073'],
	// 	['DMF_078t', 'DMF_078'],
	// 	['DMF_080t', 'DMF_080'],
	// 	['DMF_082t', 'DMF_082'],
	// 	['DMF_083t', 'DMF_083'],
	// 	['DMF_090t', 'DMF_090'],
	// 	['DMF_101t', 'DMF_101'],
	// 	['DMF_105t', 'DMF_105'],
	// 	['DMF_117t', 'DMF_117'],
	// 	['DMF_117t2', 'DMF_117'],
	// 	['DMF_118t', 'DMF_118'],
	// 	['DMF_124t', 'DMF_124'],
	// 	['DMF_163t', 'DMF_163'],
	// 	['DMF_174t', 'DMF_174'],
	// 	['DMF_184t', 'DMF_184'],
	// 	['DMF_186a', 'DMF_186'],
	// 	['DMF_244t', 'DMF_244'],
	// 	['DMF_247t', 'DMF_247'],
	// 	['DMF_248t', 'DMF_248'],
	// 	['DMF_517a', 'DMF_517'],
	// 	['DMF_526a', 'DMF_526'],
	// 	['DMF_701t', 'DMF_701'],
	// 	['DMF_703t', 'DMF_703'],
	// 	['DMF_730t', 'DMF_730'],
	// 	['DMF_526a', 'DMF_526'],
	// 	// Transfer Student should be handled on a case by case basis
	// ];

	public async loadReviewIds(query: string): Promise<readonly string[]> {
		const mysql = await getConnection();
		const dbResults: any[] = await mysql.query(query);
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
			const opponentCardId: string = this.extractOpponentCardId(replay);
			const [isTransformMarker, deckIdExtractor] = this.buildTransformMarkerFunction(miniReview, replay);

			// All entities that are present in the deck at the start of the game
			// are created using a FullEntity at game start
			const idControllerMapping = {};
			for (const entity of replay.replay.findall('.//FullEntity')) {
				// Only consider cards that start in the deck
				if (
					parseInt(entity.find(`.Tag[@tag='${GameTag.ZONE}']`).get('value')) !== Zone.DECK &&
					// We need the entities that tell us a form change occurs. They will get filtered out from
					// the decklist later on
					!isTransformMarker(entity)
				) {
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
				// Specific case for ToT, as it's the default value for the boss at the start of every game
				.filter(element => element.tag !== 'ChangeEntity')
				.filter(entity => entity.get('cardID') !== 'ULDA_BOSS_15h')
				.filter(entity => isTransformMarker(entity) || this.isEntityValid(entity));
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

			const opponentEntities: Element[] = uniqueEntities.filter(
				entity =>
					idControllerMapping[this.getId(entity)] &&
					idControllerMapping[this.getId(entity)] === replay.opponentPlayerId,
			);

			const splitEntities = {};
			let currentFormEntities: Element[] = [];
			let currentHeroDeckId = 'default';
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
				if (isTransformMarker(entity)) {
					if (currentHeroDeckId !== 'default' && currentFormEntities && currentFormEntities.length > 0) {
						splitEntities['deckId-' + currentHeroDeckId] = this.group(
							currentFormEntities.map(entity => this.getCardId(entity)),
							miniReview,
						);
						currentFormEntities = [];
						currentDeckIdEntity = this.getId(entity);
					}
					currentHeroDeckId = deckIdExtractor(entity);
					if (!this.isEntityValid(entity)) {
						continue;
					}
				}
				currentFormEntities.push(entity);
			}
			splitEntities['deckId-' + currentHeroDeckId] = this.group(
				currentFormEntities.map(entity => this.getCardId(entity)),
				miniReview,
			);
			const output = [
				{
					opponentCardId: opponentCardId,
					scenarioIds: [replay.scenarioId],
					numberOfGames: 1,
					deckCards: splitEntities,
					deckTotalCardsSeen: splitEntities,
				} as Output,
			];
			console.log('output', JSON.stringify(output));
			return output;
		} catch (e) {
			console.error('error while parsing', e, miniReview);
			return null;
		}
	}

	public async mergeReduceEvents(
		currentResult: ReduceOutput<any>,
		newResult: ReduceOutput<any>,
	): Promise<ReduceOutput<any>> {
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
		} as ReduceOutput<any>;
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

	public async transformOutput(output: ReduceOutput<any>): Promise<ReduceOutput<any>> {
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
		} as ReduceOutput<any>;
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
				cardId =>
					output.deckTotalCardsSeen[deckId][cardId] < thresholdAppearances ||
					(cardsService.getCard(cardId).type && cardsService.getCard(cardId).type.toLowerCase() === 'hero'),
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
		const deckIds: readonly string[] = Object.keys(decks);
		// When keys are integers, they are sorted in numerical order (which we don't want)
		// Otherwise they are sorted in chronological order (good!)
		const mainDeckId = deckIds[0];
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
			decks: this.cleanKeys(decks),
			deckTotalCardsInDeck: this.cleanKeys(deckTotalCardsInDeck),
			deckCards: this.cleanKeys(deckCards),
			deckTotalCardsSeen: this.cleanKeys(deckTotalCardsSeen),
			deckCardNames: this.cleanKeys(deckCardNames),
		} as FinalOutput;
	}

	private cleanKeys(input: { [deckId: string]: any }): { [deckId: string]: any } {
		const result: { [deckId: string]: any } = {};
		for (const key of Object.keys(input)) {
			const cleanKey = key.split('deckId-')[1];
			result[cleanKey] = input[key];
		}
		return result;
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

	// From what I've seen (but it's still to be confirmed):
	// - if the opponent transforms without changing the hero card, a HERO_DECK_ID is emitted
	// (this is the case for Vesh)
	// - if the hero card changes, no HERO_DECK_ID is sent, but we can use the Hero card as a marker
	private buildTransformMarkerFunction(
		miniReview: MiniReview,
		replay: Replay,
	): [(entity: Element) => boolean, (entity: Element) => string] {
		// For now we hardcode ToT
		// An option could be to use the hero power, as it is present in both ToT and GA
		// However it's possible (and likely) that the boss' HP upgrades during a fight
		// without it having a new decklist, so using the HP would be more brittle
		if (
			[3428, 3429, 3430, 3431, 3432, 3438, 3433, 3434, 3435, 3436, 3437, 3439].indexOf(replay.scenarioId) !== -1
		) {
			return [
				(entity: Element) => entity.find(`.Tag[@tag='${GameTag.HERO_DECK_ID}']`) != null,
				(entity: Element) => entity.find(`.Tag[@tag='${GameTag.HERO_DECK_ID}']`).get('value'),
			];
		}
		// Default to the "new" mechanism, as for now I don't handle older game mode
		return [
			(entity: Element) =>
				entity.find(`.Tag[@tag='${GameTag.CARDTYPE}']`) != null &&
				entity.find(`.Tag[@tag='${GameTag.ZONE}']`) != null &&
				entity.find(`.Tag[@tag='${GameTag.CONTROLLER}']`) != null &&
				parseInt(entity.find(`.Tag[@tag='${GameTag.CARDTYPE}']`).get('value')) === CardType.HERO &&
				parseInt(entity.find(`.Tag[@tag='${GameTag.ZONE}']`).get('value')) === Zone.PLAY &&
				parseInt(entity.find(`.Tag[@tag='${GameTag.CONTROLLER}']`).get('value')) === replay.opponentPlayerId,
			(entity: Element) => entity.get('cardID'),
		];
	}

	private extractOpponentCardId(replay: Replay): string {
		const opponentHeroEntityId = parseInt(
			replay.replay
				.findall(`.//Player`)
				.find(player => parseInt(player.get('playerID')) === replay.opponentPlayerId)
				.find(`Tag[@tag='${GameTag.HERO_ENTITY}']`)
				.get('value'),
		);
		return replay.replay.find(`.//FullEntity[@id='${opponentHeroEntityId}']`).get('cardID');
	}

	private getId(entity: Element): number {
		return parseInt(entity.get('id') || entity.get('entity'));
	}

	private getCardId(entity: Element): string {
		return getBaseCardId(entity.get('cardID'));
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
