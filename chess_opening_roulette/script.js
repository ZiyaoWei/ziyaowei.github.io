$(document).ready(function() {
  const chess = new Chess();
  let board;
  let currentOpening;
  let moveIndex = 0;

  const openings = [
    {
      name: "Ruy Lopez",
      moves: ["e4", "e5", "Nf3", "Nc6", "Bb5"]
    },
    {
      name: "Sicilian Defense",
      moves: ["e4", "c5"]
    },
    {
      name: "French Defense",
      moves: ["e4", "e6"]
    },
    {
      name: "Caro-Kann Defense",
      moves: ["e4", "c6"]
    },
    {
      name: "Queen's Gambit",
      moves: ["d4", "d5", "c4"]
    },
    // Add more openings as desired
  ];

  function initGame() {
    currentOpening = openings[Math.floor(Math.random() * openings.length)];
    $('#opening-name').text(`Opening: ${currentOpening.name}`);
    chess.reset();
    moveIndex = 0;

    const config = {
      draggable: true,
      position: 'start',
      onDragStart: onDragStart,
      onDrop: onDrop,
      onSnapEnd: onSnapEnd,
    };

    if (board) {
      board.position('start');
    } else {
      board = Chessboard('board', config);
    }

    $('#prompt').text('Your move:');
    $('#feedback').text('');
  }

  function onDragStart(source, piece, position, orientation) {
    // Prevent moving opponent's pieces
    if ((chess.turn() === 'w' && piece.search(/^b/) !== -1) ||
        (chess.turn() === 'b' && piece.search(/^w/) !== -1)) {
      return false;
    }

    // Prevent moving when the game is over
    if (chess.game_over()) return false;
  }

  function onDrop(source, target) {
    // See if the move is legal
    const move = chess.move({
      from: source,
      to: target,
      promotion: 'q'
    });

    // Illegal move
    if (move === null) {
      $('#feedback').text('Illegal move. Try again.');
      return 'snapback';
    }

    const expectedMoveSAN = currentOpening.moves[moveIndex];

    if (move.san === expectedMoveSAN) {
      board.position(chess.fen(), false); // Instant update for player moves
      moveIndex++;
      $('#feedback').text('Correct!');
      if (moveIndex >= currentOpening.moves.length) {
        $('#prompt').text('Opening completed!');
        // Disable further moves
        board.draggable = false;
      } else {
        // Make the next move (if it's the opponent's turn)
        if (chess.turn() === 'b') {
          setTimeout(makeExpectedMove, 300); // Add delay before computer's move
        }
      }
    } else {
      // Incorrect move
      chess.undo();
      $('#feedback').text('Incorrect move. Try again.');
      return 'snapback';
    }
  }

  function onSnapEnd() {
    board.position(chess.fen());
  }

  function makeExpectedMove() {
    const expectedMoveSAN = currentOpening.moves[moveIndex];
    const moves = chess.moves({ verbose: true });
    for (let i = 0; i < moves.length; i++) {
      if (moves[i].san === expectedMoveSAN) {
        chess.move(moves[i].san);
        board.position(chess.fen()); // Enable animation for computer moves
        moveIndex++;
        break;
      }
    }
  }

  $('#retry-btn').on('click', function() {
    chess.reset();
    moveIndex = 0;
    board.position('start');
    $('#feedback').text('');
    $('#prompt').text('Your move:');
  });

  $('#new-opening-btn').on('click', function() {
    initGame();
  });

  initGame();
});