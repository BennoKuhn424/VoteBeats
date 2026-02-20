import NowPlaying from './NowPlaying';
import UpcomingQueue from './UpcomingQueue';
import SearchBar from '../shared/SearchBar';

export default function VotingInterface({
  queue,
  venueCode,
  onVote,
  myVotes,
  onRequestSong,
}) {
  return (
    <>
      <SearchBar venueCode={venueCode} onRequestSong={onRequestSong} />

      {queue.nowPlaying && <NowPlaying song={queue.nowPlaying} />}

      <UpcomingQueue
        songs={queue.upcoming}
        onVote={onVote}
        myVotes={myVotes}
      />
    </>
  );
}
