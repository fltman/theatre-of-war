// Generalerna: en fiktiv fältmarskalk per fraktion (inga verkliga personer). Porträtten är gjorda med
// gemini-imagegen (public/img/generals/<faction>.webp, original i assets/src/generals/). Telefonen och pressen
// använder namnen och replikerna; platshållare: {months} ("three"/"six"), {until} ("July 1952"),
// {army} (motpartens armé, "the Blue Army"). Temperamentet följer fraktionens AI-personlighet i spelet.

export const GENERALS = {
  red: {
    name: 'Augustin Crane', title: 'Field Marshal', short: 'Crane', temper: 'aggressive',
    portrait: 'img/generals/red.webp',
    bio: 'A cavalryman who never forgave the horse for being replaced. Signs his orders in red pencil, and only once.',
    lines: {
      propose: [
        'Crane here. I have bigger fish to fry. {months} months of quiet between us — until {until}. Yes or no?',
        'Field Marshal Crane. Let us not waste each other\'s shells. Peace until {until}. I shan\'t ask twice.',
      ],
      accept: ['Agreed. Don\'t make me regret it.', 'Very well. Until {until}, then — and not a day longer.'],
      decline: ['Peace? With {army}? I\'d sooner surrender my boots.', 'No. I have plans for your borders.'],
      betray: ['Treaties are written in pencil for a reason.', 'You were in my way. You still are.'],
      betrayed: ['So that is how it is. You will hear from me — in person.', 'I trusted a handshake. I shall not make that mistake again.'],
      taunt: ['Your lines look thin from here.', 'I hope your generals enjoy the view of my tanks.', 'Tell your cooks to pack for a long retreat.'],
      defeat: ['Write it down: Crane did not retreat. He was out-numbered.'],
      victory: ['The world is mine. Somebody fetch me a bigger map.'],
    },
  },
  blue: {
    name: 'Ottilie Vance', title: 'General', short: 'Vance', temper: 'strategist',
    portrait: 'img/generals/blue.webp',
    bio: 'Former professor of logistics. Has never lost an argument, and keeps a ledger of everyone who tried.',
    lines: {
      propose: [
        'General Vance speaking. I have run the figures: we both gain by not fighting. {months} months — until {until}?',
        'Vance here. A modest proposal: no attacks between our armies until {until}. It is simply efficient.',
      ],
      accept: ['Sensible. I shall note it in the ledger.', 'Agreed. Until {until}. I do keep accounts, you understand.'],
      decline: ['The numbers do not favour it, I am afraid.', 'Thank you, no. You would gain rather more than I would.'],
      betray: ['Circumstances have changed. The arithmetic, regrettably, has not.', 'Nothing personal. It is in the figures.'],
      betrayed: ['How disappointing. I had you down as reliable.', 'Noted. In red ink.'],
      taunt: ['Your supply lines are a work of fiction.', 'I have read your plans. They were in the newspaper.', 'Do check your sums before you attack.'],
      defeat: ['A miscalculation. Not mine, I should add.'],
      victory: ['Exactly as projected. File it under "inevitable".'],
    },
  },
  green: {
    name: 'Edmund Harrowgate', title: 'Marshal', short: 'Harrowgate', temper: 'cautious',
    portrait: 'img/generals/green.webp',
    bio: 'Has fought in more wars than anyone at the table and won them by being somewhere else. Never lights his pipe indoors.',
    lines: {
      propose: [
        'Harrowgate here. Shall we have a little peace and quiet? {months} months, until {until}. My boys could do with the rest.',
        'Marshal Harrowgate. No sense in us shooting at each other. Until {until}, say?',
      ],
      accept: ['Splendid. I\'ll tell the lads they can take their boots off.', 'A gentleman\'s agreement, then. Until {until}.'],
      decline: ['Kind of you, but I\'d rather keep my options open.', 'Not just now, thank you. One has to be careful.'],
      betray: ['Dreadfully sorry. Needs must.', 'I never break my word. This is an exception.'],
      betrayed: ['Well, I never. And I offered you a pipe.', 'I am too old to be surprised. But I am disappointed.'],
      taunt: ['Patience wins wars. Ask anyone who is still alive.', 'I have dug in. I am very good at digging in.', 'Do come and visit. Mind the minefields.'],
      defeat: ['Well, it was a good innings.'],
      victory: ['There we are. Now, has anybody seen my tobacco?'],
    },
  },
  yellow: {
    name: 'Casimir Dorne', title: 'General', short: 'Dorne', temper: 'aggressive',
    portrait: 'img/generals/yellow.webp',
    bio: 'Promoted three times in one campaign and court-martialled twice. Both times the court apologised.',
    lines: {
      propose: [
        'Dorne here! Let\'s you and I not tangle for {months} months — until {until}. I\'m busy elsewhere, chum.',
        'General Dorne. A handshake across the wire? Until {until}. Then all bets are off.',
      ],
      accept: ['Done! Shake on it — figuratively, the line\'s terrible.', 'Deal. Until {until}, old sport.'],
      decline: ['Ha! Not a chance. I\'m having far too much fun.', 'No dice. I\'ve got my eye on your borders.'],
      betray: ['Did I say {until}? I meant now.', 'Rules are for chaps who lose.'],
      betrayed: ['Oh, you devil. I\'d have done the same — but I\'ll still flatten you.', 'Well played. Now it\'s my turn.'],
      taunt: ['Your generals called. They want their morale back.', 'Keep the kettle on — we\'re dropping by.', 'Is that your front line, or a queue for the canteen?'],
      defeat: ['Tell them Dorne went down swinging.'],
      victory: ['Drinks are on me. The whole world\'s on me, actually.'],
    },
  },
  black: {
    name: 'Severin Moor', title: 'Field Marshal', short: 'Moor', temper: 'strategist',
    portrait: 'img/generals/black.webp',
    bio: 'Plays seven games of chess by post at once and has not lost one since the old war. Speaks little, writes less.',
    lines: {
      propose: [
        'Moor. A truce between us, {months} months. Until {until}. Consider the board.',
        'Field Marshal Moor. Our quarrel can wait until {until}. Others will not wait so long.',
      ],
      accept: ['Agreed. The board is large enough for now.', 'Until {until}. I will be watching the clock.'],
      decline: ['No. That move does not suit me.', 'I think not. You would only be buying time.'],
      betray: ['The truce was a tempo move.', 'You left your king open. I was obliged.'],
      betrayed: ['A clever sacrifice. You will find it does not pay.', 'I see the move. I have already seen the reply.'],
      taunt: ['You are three moves from losing. Perhaps four.', 'Your position is worse than you think.', 'I have played this game before. You have not.'],
      defeat: ['I resign. It was a beautiful game.'],
      victory: ['Checkmate.'],
    },
  },
  purple: {
    name: 'Marguerite Ashby', title: 'General', short: 'Ashby', temper: 'cautious',
    portrait: 'img/generals/purple.webp',
    bio: 'Defended a single bridge for forty days in the last war and has not been rushed by anyone since.',
    lines: {
      propose: [
        'General Ashby. I propose we leave each other be for {months} months, until {until}. My people have had enough.',
        'Ashby speaking. Peace on our border until {until}. I find it a reasonable request.',
      ],
      accept: ['Very well. I shall hold you to it.', 'Agreed. Until {until}. Do not disappoint me.'],
      decline: ['I am not in the habit of trusting {army}.', 'No. I prefer to keep my guard up.'],
      betray: ['I warned everyone I would defend my people. This is defence.', 'You would have done it first. I simply did it sooner.'],
      betrayed: ['I expected nothing better. I am still angry.', 'You will find my bridges very hard to cross.'],
      taunt: ['Come along, then. We have been waiting.', 'Every hill you take will cost you twice.', 'My lines hold. They always hold.'],
      defeat: ['We held as long as anyone could have.'],
      victory: ['Now, perhaps, everyone can go home.'],
    },
  },
};

// Fyll i platshållarna i en replik.
export function line(text, { months = 3, until = '', army = '' } = {}) {
  const val = { months: months === 6 ? 'six' : 'three', until, army };
  // versal när platshållaren inleder en mening
  return text.replace(/\{(months|until|army)\}/g, (m, k, at) => {
    const v = val[k];
    const start = at === 0 || /[.!?]\s*$/.test(text.slice(0, at));
    return start && v ? v[0].toUpperCase() + v.slice(1) : v;
  });
}

// En replik ur kategorin, vald deterministiskt ur ett frö (samma läge ger samma replik).
export function pick(faction, cat, seed = 0) {
  const list = GENERALS[faction]?.lines[cat] ?? [];
  return list.length ? list[Math.abs(seed) % list.length] : '';
}
