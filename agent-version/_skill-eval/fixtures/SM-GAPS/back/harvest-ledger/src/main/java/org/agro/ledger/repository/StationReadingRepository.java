package org.agro.ledger.repository;

import java.math.BigDecimal;
import java.time.LocalDate;
import org.agro.ledger.domain.StationReading;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface StationReadingRepository extends JpaRepository<StationReading, Long> {
  @Query("select coalesce(sum(s.precipitationMm), 0) from StationReading s where s.readingDate between :from and :to")
  BigDecimal totalPrecipitation(LocalDate from, LocalDate to);
}
