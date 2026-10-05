# Steam Game Ownership and User Friendships Dataset

## Overview

This is a one stop shop for data necessary to make a personalized steam game recommendation system. This data was scraped from the Steam gaming platform using their open API. To the best of our knowledge, this is the first & largest open-access dataset for game ownership and user friendships of Steam data. Currently, the dataset consistents of 80k users, 34k games, 24M game ownerships, 10M friendships. User ids were anonymized by assigning a sequential id.

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html)

## Dataset Creation

This dataset was created using [Steam's Web API](https://developer.valvesoftware.com/wiki/Steam_Web_API). Given a public Steam user id, we are able to get all the games that the user owns and all the friends the user has. Given a game id, we are able to get information about the game, such as the name, price, average steam review score, etc. We scraped this dataset using a snowball sampling (BFS) technique. First, we sampled random user ids until we found a user id that was public. We would scrape that user's games and friends, and add the new friends to the BFS queue. Then, we would pop a user off the queue, and continue the scraping process with them. This process continued until a threshold number of scraped users was met.

## Dataset Structure

Each snowball (described in the dataset creation section) is formatted into its own folder named by the root (initial) user of the snowball. The users.csv file shows the user ids that contributed to the snowball, in the order that they came off the BFS queue. The friends.csv file shows all the friendships for the scraped users, formatted with user1 and user2 columns. The users_games.csv file shows that game ownerships for the scraped users along with the total and recent playtime for each user / game pair. The games.csv file shows the new games (not encountered in previous snowballs) that were encountered (owned by users) along with information such as their price, tags, description, etc.

Note: If a user was encountered in snowball B that was already scraped from snowball A, the user id will still be added to users.csv for the snowball A but friendship data and game ownership will not be added to either friends.csv or users_games.csv.

Note: If a game was encountered in snowball B that was already scraped from snowball A, the user id / game id pair will still be added to users_games.csv for the snowball A but game data will not be added to games.csv.

## Dataset Usage

This dataset was created as part of a class project for a personalized Steam game recommender: [gamesouprise.com](https://gamesouprise.com).

This project is open source and can be found on [GitHub](https://github.com/GitHubNoskcaj211/ml-projects-project).

## Contact

jackson.p.rusch@vanderbilt.edu, akash.munagala@vanderbilt.edu, jeffrey.w.pan@vanderbilt.edu, arjun.batra@vanderbilt.edu
