package org.agro.ledger.repository;

import java.util.List;
import org.agro.ledger.domain.Plot;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PlotRepository extends JpaRepository<Plot, Long> {
  List<Plot> findByOwnerNumberAndArchivedFalseOrderByName(String ownerNumber);
}
