import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { CardType, GameTag, Step, Zone } from '@firestone-hs/reference-data';
import { Element } from 'elementtree';
import { Map } from 'immutable';
import { groupBy } from '../../../mr-lambda-common/services/utils';

export class BgsTribesBuilder {
	public buidTribesAtEndGame(replay: Replay, replayXml: string): Map<string, number> {
		const elementTree = replay.replay;
		const opponentPlayerElement = elementTree
			.findall('.//Player')
			.find(player => player.get('isMainPlayer') === 'false');
		const opponentPlayerEntityId = opponentPlayerElement.get('id');
		// console.log('mainPlayerEntityId', opponentPlayerEntityId);
		const structure = {
			entities: {},
			boardByTurn: Map.of(),
			currentTurn: 0,
		};
		this.parseElement(elementTree.getroot(), replay.mainPlayerId, opponentPlayerEntityId, null, structure);
		// console.log('mapped tribes', structure.boardByTurn.toJS(), structure.boardByTurn.valueSeq());
		const tribeCompos = structure.boardByTurn.valueSeq().toArray();
		// console.log('tribeCompos', tribeCompos);
		// We're only interested in the last one
		const lastRoundCompo = tribeCompos[tribeCompos.length - 1];
		if (!lastRoundCompo) {
			console.warn('missing compo', tribeCompos);
			console.log(JSON.stringify(structure, null, 4));
			return Map.of();
		}
		// console.log('lastRoundCompo', lastRoundCompo);
		const grouped = groupBy(lastRoundCompo, card => card.tribe);
		// console.log('grouped', grouped);
		const countByTribe = grouped.map((cards: any[], tribeId: string) => cards.length).toMap();
		// console.log('countByTribe', countByTribe.toJS());
		return countByTribe.toJS();
	}

	private parseElement(
		element: Element,
		mainPlayerId: number,
		opponentPlayerEntityId: string,
		parent: Element,
		structure,
	) {
		if (element.tag === 'FullEntity') {
			structure.entities[element.get('id')] = {
				cardId: element.get('cardID'),
				controller: parseInt(element.find(`.Tag[@tag='${GameTag.CONTROLLER}']`)?.get('value') || '-1'),
				zone: parseInt(element.find(`.Tag[@tag='${GameTag.ZONE}']`)?.get('value') || '-1'),
				zonePosition: parseInt(element.find(`.Tag[@tag='${GameTag.ZONE_POSITION}']`)?.get('value') || '-1'),
				cardType: parseInt(element.find(`.Tag[@tag='${GameTag.CARDTYPE}']`)?.get('value') || '-1'),
				tribe: parseInt(element.find(`.Tag[@tag='${GameTag.CARDRACE}']`)?.get('value') || '-1'),
			};
		}
		if (element.tag === 'TagChange') {
			if (structure.entities[element.get('entity')]) {
				if (parseInt(element.get('tag')) === GameTag.CONTROLLER) {
					structure.entities[element.get('entity')].controller = parseInt(element.get('value'));
				}
				if (parseInt(element.get('tag')) === GameTag.ZONE) {
					// console.log('entity', child.get('entity'), structure.entities[child.get('entity')]);
					structure.entities[element.get('entity')].zone = parseInt(element.get('value'));
				}
				if (parseInt(element.get('tag')) === GameTag.ZONE_POSITION) {
					// console.log('entity', child.get('entity'), structure.entities[child.get('entity')]);
					structure.entities[element.get('entity')].zonePosition = parseInt(element.get('value'));
				}
			}
			if (
				parseInt(element.get('tag')) === GameTag.NEXT_STEP &&
				parseInt(element.get('value')) === Step.MAIN_START_TRIGGERS
			) {
				// console.log('considering parent', parent.get('entity'), parent);
				if (parent && parent.get('entity') === opponentPlayerEntityId) {
					const playerEntitiesOnBoard = Object.values(structure.entities)
						.map(entity => entity as any)
						.filter(entity => entity.controller === mainPlayerId)
						.filter(entity => entity.zone === Zone.PLAY)
						.filter(entity => entity.cardType === CardType.MINION)
						// .sort((a, b) => a.zonePosition - b.zonePosition)
						.map(entity => ({
							cardId: entity.cardId,
							tribe: entity.tribe,
						}));
					// console.log(
					// 	'emitting new turn values',
					// 	structure.currentTurn,
					// 	JSON.stringify(playerEntitiesOnBoard, null, 4),
					// );
					structure.boardByTurn = structure.boardByTurn.set(structure.currentTurn, playerEntitiesOnBoard);
					// console.log('updated', structure.boardByTurn.toJS(), playerEntitiesOnBoard);
					structure.currentTurn++;
				}
				// console.log('board for turn', structure.currentTurn, mainPlayerId, '\n', playerEntitiesOnBoard);
			}
		}

		const children = element.getchildren();
		if (children && children.length > 0) {
			for (const child of children) {
				this.parseElement(child, mainPlayerId, opponentPlayerEntityId, element, structure);
				// console.log('iterating', child.attrib);
			}
		}
	}
}
