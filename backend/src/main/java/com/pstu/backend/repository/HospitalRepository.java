package com.pstu.backend.repository;

import com.pstu.backend.entity.Hospital;
import com.pstu.backend.entity.Hospital.HospitalStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import java.util.List;
import java.util.Optional;

public interface HospitalRepository extends JpaRepository<Hospital, Long> {

    Optional<Hospital> findByHospitalId(String hospitalId);

    List<Hospital> findByStatusOrderByAvailableBedsDesc(HospitalStatus status);

    @Query("SELECT h FROM Hospital h WHERE h.status = :status AND h.availableBeds > 0")
    List<Hospital> findOperationalWithAvailableBeds(HospitalStatus status);

    @Query("SELECT h FROM Hospital h WHERE h.latitude BETWEEN :minLat AND :maxLat AND h.longitude BETWEEN :minLon AND :maxLon")
    List<Hospital> findHospitalsInRegion(Double minLat, Double maxLat, Double minLon, Double maxLon);
}