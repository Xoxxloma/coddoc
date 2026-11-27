package org.agro.ledger.repository;

import org.agro.ledger.domain.EntryValue;
import org.springframework.data.jpa.repository.JpaRepository;

public interface EntryValueRepository extends JpaRepository<EntryValue, Long> {
  long countByCropId(Long cropId);
}
