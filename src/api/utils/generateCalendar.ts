import { all } from 'better-all';
import Schedule from '../../common/database/eventModels/schedule';
import Game from '../../common/database/eventModels/game';
import Show from '../../common/database/configModels/show';
import logger from '../../common/logger';
import redis from '../../common/redisClient';
import { Op } from 'sequelize';
import fs from 'fs';
import path from 'path';
import rKey from '../../common/redisKeys';

async function generateCalendar(opts: string[] = []) {
    const calendarInRedis = await redis.get(`calendar:${opts}`);
    if (calendarInRedis) return calendarInRedis;

    const scheduledShows = await Schedule.findAll({ where: { rehearsal: false } });
    const visibleShows = scheduledShows.filter(s => s.visible);
    
    const gameIds = visibleShows.map(s => s.gameId);
    const { games, allShows, lastEdited } = await all({
        async games() {
            return Game.findAll({ where: { gameId: { [Op.in]: gameIds } } });
        },
        async allShows() {
            return Show.findAll();
        },
        async lastEdited() {
            return redis.get(rKey.scheduleLastEdited);
        }
    });
    
    // Create lookup maps for O(1) access
    const gameMap = new Map(games.map(g => [g.gameId, g]));
    const showMap = new Map(allShows.map(s => [s.showType, s]));

    function formatToICSDate(date = new Date()) {
        const pad = (num: number) => num.toString().padStart(2, '0');
      
        return (
          date.getUTCFullYear() +
          pad(date.getUTCMonth() + 1) + // Months are 0-indexed
          pad(date.getUTCDate()) +
          'T' +
          pad(date.getUTCHours()) +
          pad(date.getUTCMinutes()) +
          pad(date.getUTCSeconds()) +
          'Z' // Indicates UTC
        );
      }

    const showsData = visibleShows.map(schedShow => {
        const show = gameMap.get(schedShow.gameId);
        let showDisplay: Show | null = null;
        let opt: string;
        if (show) {
            showDisplay = showMap.get(show.showType) || null;
            opt = show?.opt ? show.opt : (showDisplay?.defaultOpt ?? "");
            if (!showDisplay) {
                logger.error(`missing display data! showId=${schedShow.gameId}`);
                return null;
            }
        } else {
            logger.error(`missing show data! showId=${schedShow.gameId}`);
            return null;
        }
        return { ...schedShow, ...showDisplay, opt }
    });

    let calendarHeader = fs.readFileSync(path.join(__dirname, "..", "templates/calendarHeader.txt"), "utf8");
    let calendarFooter = fs.readFileSync(path.join(__dirname, "..", "templates/calendarFooter.txt"), "utf8");
    let calendarShows = ``;

    showsData.filter((show): show is NonNullable<typeof show> => 
        show !== null && (opts.length === 0 || opts.includes(show.opt))
    ).forEach(show => {
        calendarShows = calendarShows + `BEGIN:VEVENT
CREATED:20240905T010926Z
DTEND;TZID=GMT:${new Date(new Date(show?.startTime!).getTime() + 30*60000).toISOString().replaceAll("-","").replaceAll(":","").replaceAll(".000","").replaceAll("Z","")}
DTSTAMP:${formatToICSDate()}
DTSTART;TZID=GMT:${new Date(show?.startTime!).toISOString().replaceAll("-","").replaceAll(":","").replaceAll(".000","").replaceAll("Z","")}
LAST-MODIFIED:${formatToICSDate(new Date(lastEdited ?? new Date()))}
SEQUENCE:0
SUMMARY:${show?.title}${show?.subtitle ? ' — ' + show?.subtitle : ''}
UID:${show?.gameId.toString()}${show?.itemId.toString()}
URL;VALUE=URI:com.hqtrivia://play
X-APPLE-CREATOR-IDENTITY:com.apple.mobilecal
X-APPLE-CREATOR-TEAM-IDENTITY:0000000000
BEGIN:VALARM
TRIGGER:-PT5M
DESCRIPTION:${show?.title} starts in 5 minutes!
ACTION:DISPLAY
END:VALARM
BEGIN:VALARM
TRIGGER:PT0M
DESCRIPTION:${show?.title} is starting now!
ACTION:DISPLAY
END:VALARM
END:VEVENT
`
    });

    return calendarHeader + calendarShows + calendarFooter
};

export default generateCalendar;
