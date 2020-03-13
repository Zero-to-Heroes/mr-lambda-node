import { Replay } from '@firestone-hs/hs-replay-xml-parser';
import { CardType, GameTag, Step, Zone } from '@firestone-hs/reference-data';
import { Element } from 'elementtree';
import { Map } from 'immutable';

export class BgsCompsBuilder {
	public async buildCompsByTurn(replay: Replay, replayXml: string): Promise<Map<number, readonly string[]>> {
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
		return structure.boardByTurn;
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
				attack: parseInt(element.find(`.Tag[@tag='${GameTag.ATK}']`)?.get('value') || '-1'),
				health: parseInt(element.find(`.Tag[@tag='${GameTag.HEALTH}']`)?.get('value') || '-1'),
			};
		}
		// Deathwing
		if (element.tag === 'ShowEntity' && element.get('cardID') === 'TB_BaconShop_HP_061e') {
			const attachedTo = parseInt(element.find(`.Tag[@tag='${GameTag.ATTACHED}']`)?.get('value') || '-1');
			// console.log('modifying attack', attachedTo, structure.entities[attachedTo]);
			// We don't need to remove this flag, as new entities are created for each round?
			structure.entities[attachedTo].isDeathwing = true;
			// console.log('modifyed attack', attachedTo, structure.entities[attachedTo]);
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
				if (parseInt(element.get('tag')) === GameTag.ATK) {
					// console.log('entity', child.get('entity'), structure.entities[child.get('entity')]);
					// console.log(
					// 	'changing attack',
					// 	structure.entities[element.get('entity')],
					// 	parseInt(element.get('value')),
					// );
					structure.entities[element.get('entity')].attack = parseInt(element.get('value'));
					if (structure.entities[element.get('entity')].isDeathwing) {
						structure.entities[element.get('entity')].attack -= 3;
					}
				}
				if (parseInt(element.get('tag')) === GameTag.HEALTH) {
					// console.log('entity', child.get('entity'), structure.entities[child.get('entity')]);
					structure.entities[element.get('entity')].health = parseInt(element.get('value'));
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
						.sort((a, b) => a.zonePosition - b.zonePosition)
						.map(entity => ({
							cardId: entity.cardId,
							attack: entity.attack,
							health: entity.health,
						}));
					// console.log(
					// 	'emitting new turn values',
					// 	structure.currentTurn,
					// 	JSON.stringify(playerEntitiesOnBoard, null, 4),
					// );
					structure.boardByTurn = structure.boardByTurn.set(structure.currentTurn, playerEntitiesOnBoard);
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
