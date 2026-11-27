package org.agro.ledger.repository;

import org.agro.ledger.domain.Crop;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CropRepository extends JpaRepository<Crop, Long> {
  boolean existsByCode(String code);

  long countByGroupId(Long groupId);
}
