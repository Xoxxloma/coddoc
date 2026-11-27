package org.agro.ledger.repository;

import java.time.LocalDateTime;
import java.util.Optional;
import org.agro.ledger.domain.WeatherImport;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface WeatherImportRepository extends JpaRepository<WeatherImport, Long> {
  Optional<WeatherImport> findFirstByStatusOrderByLoadedAtDesc(String status);

  @Modifying
  @Query("delete from WeatherImport w where w.status = 'FAILED' and w.loadedAt < :before")
  int deleteFailedBefore(LocalDateTime before);
}
