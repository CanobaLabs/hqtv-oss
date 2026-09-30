import { Request } from 'express';
import Audit from '../../common/database/adminModels/audit';
import Opt from '../../common/database/configModels/opt';
import Schedule from '../../common/database/eventModels/schedule';
import Keychain from '../../common/database/userModels/keychain';
import HqError from '../../common/hqError';
import logger from '../../common/logger';
import redis from '../../common/redisClient';
import rKey from '../../common/redisKeys';
import { schedTypeInfo, ScheduleDisplayName } from '../../common/types/scheduleTypes';
import ApiAnnouncement from '../models/ApiAnnouncement';
import getSchedule from '../utils/generateSchedule';
import getBalanceSummary from '../utils/getBalanceSummary';
import getOffairTriviaConfig from '../utils/getOffairTriviaConfig';
import * as offairTrivia from './offairTrivia';
import getSeason from '../utils/getSeason';
import ApiTentpole from '../models/ApiTentpole';
import eligibleChampions from '../../season2eligible.json';

export async function isSchedulePublic(scheduleName: string = '') {
	const schedType = schedTypeInfo[scheduleName as ScheduleDisplayName];
    if (!schedType || schedType?.public) {
        return true;
    } else {
        // attempting to access special schedule
        return false;
    }
}

export async function getScheduleForType(userId: number, isAdmin: boolean, isTester: boolean, scheduleName: string = '', isIOS: boolean = false, req: Request) {
	let schedType = schedTypeInfo[scheduleName as ScheduleDisplayName];
    if ((isAdmin || isTester) && !schedType) {
        // default to all shows ... helpful for android which has no debug
        schedType = schedTypeInfo['All Shows'];
    }
    let scheduleShows = await getSchedule(schedType?.name ?? 'normal');
    const offairGame = await offairTrivia.getOutwardsGame(userId);
    const offairConfig = await getOffairTriviaConfig();
    const seasonConfig = await getSeason();
    const announcements = [];
    const redisAnnouncements = (await redis.json.get(rKey.announcements) ?? []) as Array<{ active?: boolean; name?: string; iosOnly?: boolean; [key: string]: unknown }>;
    const activeAnnouncements = redisAnnouncements
        .filter(announcement => {
            // Filter out inactive announcements
            if (announcement.active === false) return false;
            // Filter iOS-only announcements: show only if client is iOS
            if (announcement.iosOnly === true && !isIOS) return false;
            return true;
        })
        .map(({ name, iosOnly, ...announcement }) => announcement); // Remove 'name' and 'iosOnly' fields before sending to users
    announcements.push(...activeAnnouncements);

    const key = await Keychain.findOne({ where: { userId: userId } });
    if (key?.pinHash === null) {
        const antiTheftAnnouncement = await redis.get('schedule:antiTheftAnnounce');
        if (antiTheftAnnouncement) {
            // always show above any other announcement
            announcements.unshift(JSON.parse(antiTheftAnnouncement));
        }
    }
    let xHqClient: string | undefined;
    xHqClient = req.headers['x-hq-client'] as string | undefined;

    if (xHqClient === "Android/1.53.3") {
        const updateAnnouncement = await redis.get('schedule:updateAnnouncement');
        if (updateAnnouncement) {
            // always show above any other announcement
            announcements.unshift(JSON.parse(updateAnnouncement));
        }
    }

    if (!eligibleChampions.includes(userId)) {
        scheduleShows = scheduleShows.filter(show => show.showId != 1027)
    };

    return {
        shows: scheduleShows,
        offairTrivia: offairConfig.enabled ? {
            isGameInProgress: !!offairGame,
            waitTimeMs: await offairTrivia.getWaitTimeToNextGame(userId),
            powerups: {
                'offair-10x-pts-multi': 0,
                OFFAIR_PTS_MULTI_10: 0,
                'offair-unlock': 0,
                OFFAIR_UNLOCK: 0
            },
            games: offairGame ? [offairGame] : []
        } : undefined,
        announcements: announcements,
        tentpoles: seasonConfig && (seasonConfig.tentpoleEnabled || (seasonConfig.tentpoleEnabled_android === '1' && !isIOS)) ? [
            new ApiTentpole(
                seasonConfig.seasonName,
                seasonConfig.seasonName,
                process.env.CDN_URL + '/hqtv/static/season-xp/homescreen-jackpot-generic.png',
                process.env.CDN_URL + '/hqtv/static/season-xp/homescreen-jackpot-generic.mp4',
                seasonConfig.finalePrizeCents,
                seasonConfig.endDate.toISOString(),
                seasonConfig.howItWorks,
                seasonConfig.disclaimer
            )
        ] : undefined
    }
}

export async function editScheduleItem(scheduleItemIdStr: string, body: { [k: string]: unknown; }) {
    // edits a schedule item
    const scheduleItem = await Schedule.findByPk(scheduleItemIdStr);
    if (!scheduleItem) throw new HqError('Schedule item not found', 0, 404);
    await Schedule.update(body, { where: { itemId: scheduleItemIdStr } });
    // Parallelize schedule generation and cache invalidation
    await Promise.all([
        getSchedule('normal', true),
        getSchedule('rehearsal', true),
        getSchedule('all', true),
        redis.del(rKey.apGameSchedule(scheduleItem.gameId.toString()))
    ]);
    return { success: true };
}

export async function deleteScheduleItem(scheduleItemIdStr: string, employeeId: string) {
    // deletes a schedule item
    const scheduleItem = await Schedule.findByPk(scheduleItemIdStr);
    if (!scheduleItem) throw new HqError('Schedule item not found', 0, 404);
    await Schedule.destroy({ where: { itemId: scheduleItemIdStr } });
    await Audit.create({
        to: scheduleItem.gameId,
        toType: 'game',
        subTo: scheduleItem.itemId,
        subToType: 'schedule',
        from: employeeId,
        fromType: 'employee',
        action: 'delete_schedule',
        description: `Deleted scheduled airing for ${scheduleItem.startTime ? new Date(scheduleItem.startTime).toLocaleDateString("en-US", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric' }) : 'Airing Soon'}`
    });
    // Parallelize schedule generation and cache invalidation
    await Promise.all([
        getSchedule('normal', true),
        getSchedule('rehearsal', true),
        getSchedule('all', true),
        redis.del(rKey.apGameSchedule(scheduleItem.gameId.toString()))
    ]);
    return { success: true };
}

export async function getOpts() {
	const cache = await redis.get(rKey.opts);
    let opts = [];
    if (cache) {
        opts = JSON.parse(cache);
    } else {
        logger.info('updating opts in redis');
        const dbOpts = await Opt.findAll();
        opts = dbOpts.map(o => ({
            title: o.title,
            opt: o.opt,
            in: 'Subscribe',
            out: 'Subscribed',
            onboardingDescription: o.description,
            opted: true
        }));
        await redis.set(rKey.opts, JSON.stringify(opts));
    }
    return { opts: opts };
}
