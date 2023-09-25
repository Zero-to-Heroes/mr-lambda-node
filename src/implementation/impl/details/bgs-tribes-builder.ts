import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { CardType, GameTag, Step, Zone } from '@firestone-hs/reference-data';
import { Element } from 'elementtree';
import { Map } from 'immutable';
import { groupBy } from '../../../mr-lambda-common/services/utils';

export class BgsTribesBuilder {
	public buidTribesAtEndGame(replay: Replay, replayXml: string): { [tribeId: string]: number } {
		const elementTree = replay.replay;
		const opponentPlayerElement = elementTree
			.findall('.//Player')
			.find(player => player.get('isMainPlayer') === 'false');
		const opponentPlayerEntityId = opponentPlayerElement.get('id');
		const structure = {
			entities: {},
			boardByTurn: Map.of(),
			currentTurn: 0,
		};
		this.parseElement(elementTree.getroot(), replay.mainPlayerId, opponentPlayerEntityId, null, structure);
		const tribeCompos = structure.boardByTurn.valueSeq().toArray();
		// We're only interested in the last one
		const lastRoundCompo = tribeCompos[tribeCompos.length - 1];
		if (!lastRoundCompo) {
			console.warn('missing compo', tribeCompos);
			return {};
		}
		const grouped = groupBy(lastRoundCompo, card => card.tribe);
		const countByTribe = grouped.map((cards: any[], tribeId: string) => cards.length).toMap();
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
				tribe: parseInt(element.find(`.Tag[@tag='${GameTag.CARDRACE}']`)?.get('value') || '25'),
			};
			// if (structure.entities[element.get('id')].tribe == '-1') {
			// 	console.warn('invalid tribe', element);
			// }
		}
		if (element.tag === 'TagChange') {
			if (structure.entities[element.get('entity')]) {
				if (parseInt(element.get('tag')) === GameTag.CONTROLLER) {
					structure.entities[element.get('entity')].controller = parseInt(element.get('value'));
				}
				if (parseInt(element.get('tag')) === GameTag.ZONE) {
					structure.entities[element.get('entity')].zone = parseInt(element.get('value'));
				}
				if (parseInt(element.get('tag')) === GameTag.ZONE_POSITION) {
					structure.entities[element.get('entity')].zonePosition = parseInt(element.get('value'));
				}
			}
			if (
				parseInt(element.get('tag')) === GameTag.NEXT_STEP &&
				parseInt(element.get('value')) === Step.MAIN_START_TRIGGERS
			) {
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
							initialElement: entity.initialElement,
						}));
					structure.boardByTurn = structure.boardByTurn.set(structure.currentTurn, playerEntitiesOnBoard);
					structure.currentTurn++;
				}
			}
		}

		const children = element.getchildren();
		if (children && children.length > 0) {
			for (const child of children) {
				this.parseElement(child, mainPlayerId, opponentPlayerEntityId, element, structure);
			}
		}
	}
}
