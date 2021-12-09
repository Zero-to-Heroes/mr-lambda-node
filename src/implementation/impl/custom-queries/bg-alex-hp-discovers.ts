/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { AllCardsService, BlockType } from '@firestone-hs/reference-data';
import { MiniReview } from '../../../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../../../mr-lambda-common/models/reduce-output';
import { getConnection } from '../../../mr-lambda-common/services/rds';
import { groupBy, http } from '../../../mr-lambda-common/services/utils';
import { Implementation } from '../../implementation';

export class BgAlexHpDiscovers implements Implementation<any> {
	public async loadReviewIds(query: string): Promise<readonly string[]> {
		const lastBattlegroundsPatch = await getLastBattlegroundsPatch();
		const mysql = await getConnection();

		const defaultQuery = `
			SELECT reviewId FROM replay_summary
			WHERE gameMode = 'battlegrounds'
			AND buildNumber >= ${lastBattlegroundsPatch}
			AND playerCardId = 'TB_BaconShop_HERO_56'
			ORDER BY creationDate DESC
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

		try {
			const elementTree = replay.replay;
			// Also includes opponent, but not an issue
			const queenOfDragonsEntity = elementTree.find(`.//FullEntity[@cardID='TB_BaconShop_HP_064']`);
			if (!queenOfDragonsEntity) {
				return null;
			}
			const entityId = queenOfDragonsEntity.get('id');
			const heroPowerTriggerBlock = elementTree.find(
				`.//Block[@entity='${entityId}'][@type="${BlockType.TRIGGER}"]`,
			);
			if (!heroPowerTriggerBlock) {
				return null;
			}

			const choices = heroPowerTriggerBlock.findall(`.//Choices`);
			const choiceOptions = choices.map(choice => choice.findall(`.//Choice`)).reduce((a, b) => a.concat(b), []);
			if (choiceOptions.length !== 6) {
				console.warn('invalid set of choice options');
			}
			const fullEntities = heroPowerTriggerBlock.findall(`.//FullEntity`);
			const fullEntitiesInChoices = choiceOptions
				.map(choice => choice.get('entity'))
				.map(choiceEntityId => fullEntities.find(entity => entity.get('id') === choiceEntityId));

			const picks = heroPowerTriggerBlock.findall(`.//ChosenEntities`);
			const pickOptions = picks.map(choice => choice.findall(`.//Choice`)).reduce((a, b) => a.concat(b), []);
			if (pickOptions.length !== 6) {
				console.warn('invalid set of pick options');
			}
			const fullEntitiesInPicks = pickOptions
				.map(choice => choice.get('entity'))
				.map(choiceEntityId => fullEntities.find(entity => entity.get('id') === choiceEntityId));

			const output = {
				choices: choiceOptions.map(choice =>
					fullEntitiesInChoices.find(entity => entity.get('id') === choice.get('entity')).get('cardID'),
				),
				picks: pickOptions.map(choice =>
					fullEntitiesInPicks.find(entity => entity.get('id') === choice.get('entity')).get('cardID'),
				),
			};
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
			return newResult;
		}
		if (!newResult) {
			return currentResult;
		}
		return {
			output: this.mergeOutputs(currentResult.output || [], newResult.output || []),
		} as ReduceOutput<any>;
	}

	private mergeOutputs(firstOutput, secondOutput): any {
		const result = {
			choices: (firstOutput.choices || []).concat(secondOutput.choices || []),
			picks: (firstOutput.picks || []).concat(secondOutput.picks || []),
		};
		return result;
	}

	public async transformOutput(output: ReduceOutput<any>): Promise<ReduceOutput<any>> {
		const cards = new AllCardsService();
		await cards.initializeCardsDb();
		const result = {
			output: {
				choices: merge(output.output.choices),
				picks: merge(output.output.picks),
			},
		};
		return result;
	}
}

const merge = (values: readonly string[]): any => {
	const mergedChoices = groupBy(values, cardId => cardId);
	const consolidatedChoices = mergedChoices.map((value, key) => value.length);
	const finalChoices = {};
	consolidatedChoices.keySeq().forEach(cardId => {
		finalChoices[cardId] = consolidatedChoices.get(cardId);
	});
	return finalChoices;
};

export const getLastBattlegroundsPatch = async (): Promise<number> => {
	const patchInfo = await http(`https://static.zerotoheroes.com/hearthstone/data/patches.json`);
	const structuredPatch = JSON.parse(patchInfo);
	return structuredPatch.currentBattlegroundsMetaPatch;
};
