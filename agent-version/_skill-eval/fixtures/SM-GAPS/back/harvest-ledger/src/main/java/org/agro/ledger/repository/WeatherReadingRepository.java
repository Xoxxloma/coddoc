package org.agro.ledger.repository;

import java.time.LocalDate;
import java.util.Optional;
import org.agro.ledger.domain.WeatherReading;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WeatherReadingRepository extends JpaRepository<WeatherReading, Long> {
  Optional<WeatherReading> findByFarmIdAndReadingDate(Long farmId, LocalDate date);
}
