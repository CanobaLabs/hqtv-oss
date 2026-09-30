import { bold, ColorResolvable, EmbedBuilder } from 'discord.js';
import percentRound from 'percent-round';
import Show from '../../common/database/configModels/show';
import GiftDropItem from '../../common/database/featureModels/giftDropItem';
import redis from '../../common/redisClient';
import generatePrizeDisplayText from '../helpers/generatePrizeDisplayText';
import sendDiscordPrompter from '../helpers/sendDiscordPrompter';
import { getSurveyQuestionResults } from '../helpers/surveyQuestionMethods';
import rGameKey from './redisGameKeys';
import RedisPuzzle from '../redisSchemas/redisPuzzle';
import RedisQuestion from '../redisSchemas/redisQuestion';
import WinInfo from '../redisSchemas/winInfo';
import WsGameInfo from './WsGameInfo';
import WsSurveyQuestion from './WsSurveyQuestion';
import { bulkGetUsers } from '../../common/utils/userGetters';

class DiscordPrompt {
    gameInfo: WsGameInfo;
    embed: EmbedBuilder;
    constructor(gameInfo: WsGameInfo, type: 'pre' | 'now' | 'hl', title: string | null = null) {
        this.gameInfo = gameInfo;
        this.embed = new EmbedBuilder().setTitle(title);
        if (type == 'now') {
            const gameTypeColours: { [gameType: string]: ColorResolvable; } = {
                trivia: '#33379a',
                words: '#fed12c'
            }
            this.embed
                .setColor(gameTypeColours[gameInfo.gameType])
                .setFooter({ text: `GameId=${gameInfo.gameId} BroadcastId=${gameInfo.broadcastId} Rehearsal=${+gameInfo.rehearsal} Real=${+gameInfo.forReal}` });
        } else if (type == 'hl') {
            this.embed.setColor(0xfaa61a); // Muted orange for highlights
        } else if (type == 'pre') {
            // Default color for pre-game embeds (Discord blurple)
            this.embed.setColor(0x5865f2);
        }
    }
    
    async gameStarted(): Promise<EmbedBuilder> {
        const { gameInfo } = this;
        const showDisplay = await Show.findOne({ where: { showType: this.gameInfo.showType }});
        this.embed
            .setTitle('Game started')
            .setDescription('You\'ve got this!')
            .setThumbnail(showDisplay?.logoUrl ?? null)
            .setColor(0x57f287); // Discord success green for positive start action

        return this.embed;
    }

}

export default DiscordPrompt;
