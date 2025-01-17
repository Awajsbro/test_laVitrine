import axios from "axios"
import * as fs from "fs"
import * as csv from "fast-csv"
import moment from "moment-timezone";


const BASE_URL = "https://app.ticketmaster.com/discovery/v2/events";
const API_KEY = "1gRfrqj6lwxAhL5VX7MVquYoOI4SostP";
const DEFAULT_START_DATE = "2025-02-01T00:00:00"
const DEFAULT_END_DATE = "2025-06-30T00:00:00"
const DEFAULT_FILENAME = "events.csv"


// Extrait les information desirer des evenement
const extractDataFromEvent = (event) => {
    const dates = event.dates.start
    const location = event._embedded.venues[0]

    return {
        id: event.id,
        name: event.name,
        dateTime: `${dates.localDate}T${dates.localTime}`,
        location: location.name,
        address: `${location.address.line1}, ${location.postalCode} ${location.city.name}`,
        imageUrl: event.images.sort((a, b) => b.width * b.height - a.width * a.height)[0].url
    }
}


// Recupere les donnees depuis l'API
const fetchEvents = async (filter) => {
    let data = []
    // Transforme les dates de maniere a respecter le fuseau horraire
    let queryDatetime = moment.tz(DEFAULT_START_DATE, "America/Montreal")
    const endDatetime = moment.tz(DEFAULT_END_DATE, "America/Montreal")


    // Il est impossible de tout requeter sur une periode qui a plus de 1000 events un boucle sur de plus petite periode est donc necessaire
    while (queryDatetime.isSameOrBefore(endDatetime)) {
        let otherPageEvents = []

        // Premiere appel a l'API de la boucle et le seul si il y a moins de 200 events au quebec
        const response = await axios.get(BASE_URL, {
            params: {
                apikey: API_KEY,
                countryCode: "CA",
                stateCode: "QC",
                startDateTime: queryDatetime.format("YYYY-MM-DDTHH:mm:ssZ"),
                endDateTime: moment.min(queryDatetime.clone().add(2, "months"), endDatetime).format("YYYY-MM-DDTHH:mm:ssZ"),
                size: 200,
                classificationName: filter
            }
        });

        // Grace au premiere appel on peut connaitre le nombre d'events pendant la periode et donc passer les appels a l'API pour les events a partir du 201eme et stocker ces appels en attendant d'avoir un retour
        for (let i = 1; i < response.data.page.totalPages; i++) {
            otherPageEvents.push(axios.get(BASE_URL, {
                params: {
                    apikey: API_KEY,
                    countryCode: "CA",
                    stateCode: "QC",
                    startDateTime: queryDatetime.format("YYYY-MM-DDTHH:mm:ssZ"),
                    endDateTime: moment.min(queryDatetime.clone().add(2, "months"), endDatetime).format("YYYY-MM-DDTHH:mm:ssZ"),
                    size: 200,
                    page: i,
                    classificationName: filter
                }
            }))
        }

        // En attendant les retours des dernier appel on peut extraire les donnees le premier qui avait ete passe
        response.data._embedded.events.forEach((event) => {
            data.push(extractDataFromEvent(event))
        });

        // On attends que la liste des appels stocker precedement recoive leurs reponses
        const eventPages = await Promise.all(otherPageEvents)

        // On extrait les donnees des reponses arrivaient
        eventPages.forEach((page) => {
            page.data._embedded.events.forEach((event) => {
                data.push(extractDataFromEvent(event))
            });
        });

        // Et on fini la boucle en incrementant la date de debut de periode pour passer a la suivante tant qu'on a pas atteind la date de fin voulu initialement
        queryDatetime.add(2, "months").add(1, "second")
    }

    return data
}


// Transforme les donnees en CSV et sauvegarde le fichier
const exportCSV = async (events, fileName) => {
    const csvStream = csv.format({ headers: true })
    const writeStream = fs.createWriteStream(fileName)

    csvStream.pipe(writeStream)
    events.forEach(event => csvStream.write(event))
    csvStream.end()
}


// Recuperation des categorie si mise et lancement des fonction plus haut
const main = async () => {
    const args = process.argv.slice(2)
    let fileName = DEFAULT_FILENAME

    if (args[0] !== undefined)
        fileName = `${args.join("_")}.csv`

    const events = await fetchEvents(args.join(","))

    exportCSV(events, fileName)
}


main()
