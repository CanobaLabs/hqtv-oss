type ScheduleDisplayName = 'Public Shows' | 'Rehearsal Shows' | 'All Shows';

type ScheduleAltName = 'normal' | 'rehearsal' | 'all';

const schedTypeInfo: { [type in ScheduleDisplayName]: { name: ScheduleAltName; public: boolean } | undefined} = {
	'All Shows': { name: 'all', public: false },
    'Rehearsal Shows': { name: 'rehearsal', public: false },
    'Public Shows': { name: 'normal', public: true }
}

export { schedTypeInfo, ScheduleDisplayName, ScheduleAltName };
