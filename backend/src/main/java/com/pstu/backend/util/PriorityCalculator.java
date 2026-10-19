package com.pstu.backend.util;

import com.pstu.backend.entity.EmergencyIncident;
import com.pstu.backend.entity.Resource;

public class PriorityCalculator {

    public static int calculatePriority(EmergencyIncident incident) {
        int score = 0;
        score += switch (incident.getSeverity()) {
            case LOW -> 10;
            case MEDIUM -> 30;
            case HIGH -> 60;
            case CRITICAL -> 80;
            case CATASTROPHIC -> 100;
        };
        score += Math.min(incident.getAffectedPeople() / 10, 30);
        score += Math.max(0, 20 - incident.getTimeSensitivityMinutes() / 5);
        if (incident.getEnvironmentalConditions() != null && !incident.getEnvironmentalConditions().isEmpty()) {
            score += 5;
        }
        return Math.min(score, 100);
    }

    public static int calculateTravelTime(EmergencyIncident incident, Resource resource) {
        double distance = haversineDistance(incident.getLatitude(), incident.getLongitude(), resource.getLatitude(), resource.getLongitude());
        double speed = resource.getTravelSpeedKmh() != null ? resource.getTravelSpeedKmh() : 60.0;
        return (int) Math.ceil((distance / speed) * 60);
    }

    public static double haversineDistance(double lat1, double lon1, double lat2, double lon2) {
        double R = 6371.0;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
}