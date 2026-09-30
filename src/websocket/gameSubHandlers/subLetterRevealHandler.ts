import constructLetterResponse from '../constructors/constructLetterResponse';
import { getPuzzle } from '../helpers/gameDataGetters';
import getGameInfo from '../helpers/getGameInfo';
import { checkPuzzleCompletion, isPlayerSolving } from '../helpers/playerMethods';
import { wsServers } from '../wsServers';

interface SubLetterRevealArgs {
    letter: string;
}

async function subLetterRevealHandler(broadcastId: number, e: SubLetterRevealArgs) {
    const gameInfo = await getGameInfo(broadcastId);
    const puzzle = (await getPuzzle(broadcastId))!;
    
    const promises: Promise<void>[] = [];
    wsServers[broadcastId]?.wss.clients.forEach(({ player }) => {
        promises.push((async () => {
            const solving = await isPlayerSolving(player);
            if (solving) {
                await checkPuzzleCompletion(player, puzzle, +gameInfo.questionNumber);
            }
        })());
    });
    await Promise.all(promises);
    
    wsServers[broadcastId]?.wss.sendAll(constructLetterResponse(gameInfo, puzzle, e.letter, 'letterReveal'));
}

export { SubLetterRevealArgs, subLetterRevealHandler };
