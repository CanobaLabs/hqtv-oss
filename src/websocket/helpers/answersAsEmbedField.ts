import WsQuestion from '../wsTypes/WsQuestion';

function answersAsEmbedField(answers: WsQuestion['answers'], answerCounts?: WsQuestion['answerCounts']) {
    const answerDescriptions = answers.map((a, i) => {
        const answerLetter = String.fromCharCode(i + 1 + 64); // a, b, c, ...
        const answerName = a.correct ? `**${a.text}**` : a.text; // only bold correct answer when answers close
        let answerDesc = `${answerLetter}: ${answerName}`;
        if (answerCounts) {
            answerDesc += ` — ${answerCounts![a.id]}`;
        }
        return answerDesc;
    });
    return answerDescriptions.join('\n');
}

export default answersAsEmbedField;
