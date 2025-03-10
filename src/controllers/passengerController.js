const pool = require("../utils/db");

const getTripsHandler = async (req , res) => {
    try {
        const { locationMarker, destinationMarker, time, date } = req.body;
    
        const { latitude: startLat, longitude: startLon } = locationMarker;
        const { latitude: destLat, longitude: destLon } = destinationMarker;
    
        // Define constants
        const distanceThreshold = 5 * 1000; // 5 km in meters
        const timeOffset = '1 hour'; // +/- 1 hour
        const averageSpeed = 40; // Average driving speed in km/h (adjust as needed)
    
        const query = `
          SELECT 
            trips.tripid,
            trips.driverid,
            trips.vehicleid,
            trips.numberofpassengers,
            trips.numberofstops,
            trips.overallrating,
            trips.price,
            trips.triptime,
            trips.tripdate,
            trips.totalseats,
            ST_X(trips.startlocation) AS startlatitude,
            ST_Y(trips.startlocation) AS startlongitude,
            ST_X(trips.destinationlocation) AS destinationlatitude,
            ST_Y(trips.destinationlocation) AS destinationlongitude,
            ST_DistanceSphere(startlocation, ST_SetSRID(ST_Point($1, $2), 4326)) AS distance,
            users.username,
            users.profile_photo,
            vehicles.vehiclename,
            vehicles.vehiclecolor,
            vehicles.vehiclenumber,
            vehicles.vehicleaverage
          FROM trips
          JOIN drivers ON trips.driverid = drivers.driverid
          JOIN users ON drivers.userid = users.userid
          JOIN vehicles ON trips.vehicleid = vehicles.vehicleid
          WHERE 
            ST_DistanceSphere(startlocation, ST_SetSRID(ST_Point($1, $2), 4326)) <= $3
            AND ST_DistanceSphere(destinationlocation, ST_SetSRID(ST_Point($4, $5), 4326)) <= $3
            AND trips.tripdate = $6
            AND trips.triptime BETWEEN ($7::time - $8::interval) AND ($7::time + $8::interval)
          LIMIT 5;
        `;
    
        const values = [
          startLon,
          startLat,
          distanceThreshold,
          destLon,
          destLat,
          date,
          time,
          timeOffset,
        ];
    
        const result = await pool.query(query, values);
    
        const formattedTrips = result.rows.map(row => {
            const distanceInKm = row.distance / 1000; // Convert distance to kilometers
            const estimatedTimeInHours = distanceInKm / averageSpeed;
            const estimatedTimeInMinutes = Math.round(estimatedTimeInHours * 60);
        
            return {
                tripid: row.tripid,
                driverid: row.driverid,
                vehicleid: row.vehicleid,
                numberofpassengers: row.numberofpassengers,
                numberofstops: row.numberofstops,
                overallrating: row.overallrating,
                price: row.price,
                triptime: row.triptime,
                tripdate: row.tripdate,
                totalseats: row.totalseats,
                startlocation: {
                latitude: row.startlatitude,
                longitude: row.startlongitude,
                },
                destinationlocation: {
                latitude: row.destinationlatitude,
                longitude: row.destinationlongitude,
                },
                distance: distanceInKm.toFixed(2), // Distance in km rounded to 2 decimal places
                estimatedTime: `${estimatedTimeInMinutes} minutes`, // Estimated time in minutes
                username: row.username,
                profile_photo: row.profile_photo,
                vehiclename: row.vehiclename,
                vehiclecolor: row.vehiclecolor,
                vehiclenumber: row.vehiclenumber,
                vehicleaverage: row.vehicleaverage,
            };
        });
    
        res.status(200).json(formattedTrips);
    } catch (error) {
        console.error('Error fetching trips:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const tripJoinReq = async (req, res) => {
  try {
      const { tripId, passengerId } = req.body;

      // Check available passenger slots
      const { rows } = await pool.query(
          `SELECT NumberOfPassengers FROM Trips WHERE TripID = $1`,
          [tripId]
      );

      if (rows.length === 0) {
          return res.status(404).json({ message: 'Trip not found' });
      }

      const availableSlots = rows[0].numberofpassengers;
      if (availableSlots <= 0) {
          return res.status(400).json({ message: 'No available slots for this trip' });
      }

      const result = await pool.query(
          `INSERT INTO TripRequests (TripID, PassengerID, Status) 
           VALUES ($1, $2, 'PENDING') 
           RETURNING RequestID`,
          [tripId, passengerId]
      );

      res.status(201).json({
          message: 'Trip join request sent',
          requestId: result.rows[0].requestid,
      });

  } catch (err) {
      console.error('Error requesting to join trip:', err);
      res.status(500).json({ message: 'Server error' });
  }
};

const getUserActiveRequests = async (req, res) => {
  try {
      const userId = req.user.userId;

      const result = await pool.query(
          `SELECT 
              tr.RequestID,
              tr.Status,
              t.TripID,
              t.StartLocation,
              t.Destination,
              t.Date,
              t.Time
          FROM TripRequests tr
          JOIN Trips t ON tr.TripID = t.TripID
          JOIN Passengers p ON tr.PassengerID = p.PassengerID
          WHERE p.UserID = $1
            AND t.Status != 'COMPLETED'
            AND (t.Date > CURRENT_DATE OR (t.Date = CURRENT_DATE AND t.Time > CURRENT_TIME))`,
          [userId]
      );

      if (result.rowCount === 0) {
          return res.status(200).json({ message: 'No active trip requests found', tripRequests: [] });
      }

      res.status(200).json({
          activeRequests: result.rows.map(row => ({
              requestId: row.requestid,
              status: row.status,
              trip: {
                  tripId: row.tripid,
                  startLocation: row.startlocation,
                  destination: row.destination,
                  date: row.date,
                  time: row.time
              }
          }))
      });

  } catch (err) {
      console.error('Error fetching active trip requests:', err);
      res.status(500).json({ message: 'Server error' });
  }
};


module.exports = { getTripsHandler, tripJoinReq, getUserActiveRequests }