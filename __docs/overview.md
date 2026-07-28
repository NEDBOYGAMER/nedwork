# project

## top level
every code sits inside of flask app

the rest is the instance folder wich contains the databases(only one atm)[text](../instance)

stuff contains nothing of importance

.gitignore is for git to kjnow what to ignore

app.py is the starting script (start when coding locally (i think))

[database_fill_v2](../database_fill_v2.py) is to populate the database (not needed)

requirements is autdated and not really used

robots.txt is just for webscrapers



# flask app
## overview

in init the flask app is defined and all the imports are handled

models is for the classes for the database
here you can add colums to the database and tables

templates here live the html documents

static for javascript, css and images and other assets

data for stuff that never changes runtime and therefore doesnt need a database table

the rest of the folders are flask route folders




a new flask route (or editing one):
two options:
you want to add a new app
you want to add a new major site

for the first you can go to


more on models:
the model file just defines all the different structures in the database and their connections

definine a class using the normal python method but give the db.model as parameter

think of db.modal class essentially as a table where every value/variable represents a column

you can add a column like this

    username = db.Column(db.String(40), unique=True, nullable=False)

first the column name/ varable name
then db.column with the parameters (
    data type: string int and so on sttring need the lenght of the string, just look at the rest of the code
    unique: makes it impossible to add another entry to the table with the same value (for this column)
    nullable: can't be null (duh)
    primary_key: dont get it exactly myself but this is the value the table is indexed by ( automatically enabvles unique and nullable for this column) two value can be primary which means that the combination must be unique
)

look up realtionships on your own as i have no idea



more on init:

for every new flask root folder / every new routes.py create and entrys in init

    from flask_app.main.routes import main_bp
from   then the route and how you called your blueprint (please always with name_bp)

then also add the registry entry

    app.register_blueprint(auth_bp, url_prefix='/auth')

self explanitory, just replace the names with the names of your new bp
url_prefixes are for the pupose that there is no need for writing them every time in routes.py

save the file and reload the app





