package org.agro.ledger.repository;

import java.util.List;
import org.agro.ledger.domain.CropGroup;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CropGroupRepository extends JpaRepository<CropGroup, Long> {
  List<CropGroup> findAllByOrderBySortOrderAscNameAsc();
}
