package org.agro.ledger.repository;

import java.time.LocalDateTime;
import java.util.Collection;
import org.agro.ledger.domain.PestCaseView;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface PestCaseViewRepository extends JpaRepository<PestCaseView, Long> {

  @Query("select count(p) from PestCaseView p where p.regionId in :regions and p.closedAt between :from and :to")
  long countClosedInRegions(Collection<Long> regions, LocalDateTime from, LocalDateTime to);

  @Query("select count(p) from PestCaseView p where p.farmId in :farms and p.closedAt between :from and :to")
  long countClosedOnFarms(Collection<Long> farms, LocalDateTime from, LocalDateTime to);
}
